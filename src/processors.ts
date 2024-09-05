import axios, { AxiosError } from 'axios';
import { Voter, Producer } from './types';
import { API_SERVERS } from './config';

const MAX_RETRIES = 10;
const INITIAL_BACKOFF = 1000; // 1 second
const MAX_BACKOFF = 60000; // 60 seconds
const BACKOFF_MULTIPLIER = 2;
const TIMEOUT = 5000; // 5 seconds

async function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export async function fetchVoters(): Promise<Voter[]> {
    const voters: Voter[] = [];
    let lowerBound = 0;
    let more = true;
    let serverIndex = 0;

    while (more) {
        const server = API_SERVERS[serverIndex];
        try {
            const response = await retryRequest(() =>
                axios.post(`${server}/v1/chain/get_table_rows`, {
                    json: true,
                    code: 'eosio',
                    scope: 'eosio',
                    table: 'voters',
                    lower_bound: lowerBound,
                    limit: '1000'
                }, { timeout: TIMEOUT })
            );

            const data = response.data;
            voters.push(...data.rows.map((row: any) => ({
                ...row,
                last_vote_weight: parseFloat(row.last_vote_weight) / 1000000000,
                proxied_vote_weight: parseFloat(row.proxied_vote_weight) / 1000000000,
                balance: 0,
                available: 0,
                locked4: 0,
                fio_public_key: '',
                correct_last_vote_weight: 0,
                wrong_last_vote_weight: 0,
                correct_proxied_vote_weight: 0,
                wrong_proxied_vote_weight: 0
            })));

            more = data.more;
            if (more) {
                lowerBound = voters[voters.length - 1].id + 1;
            }
        } catch (error) {
            console.error(`Failed to fetch voters from server ${server}:`, error);
        }

        serverIndex = (serverIndex + 1) % API_SERVERS.length;
    }

    return voters;
}

async function retryRequest(fn: () => Promise<any>, retries: number = 0): Promise<any> {
    try {
        return await fn();
    } catch (error) {
        if (axios.isAxiosError(error) && retries < MAX_RETRIES) {
            const backoffTime = Math.min(INITIAL_BACKOFF * Math.pow(BACKOFF_MULTIPLIER, retries), MAX_BACKOFF);
            console.log(`Request failed. Scheduling retry in ${backoffTime}ms... (${retries + 1}/${MAX_RETRIES})`);
            await sleep(backoffTime);
            return retryRequest(fn, retries + 1);
        }
        throw error;
    }
}

async function processBatch(voters: Voter[], updateFunction: (voter: Voter, server: string) => Promise<void>, updateProgress: (current: number, total: number) => void, totalVoters: number): Promise<Voter[]> {
    const failedVoters: Voter[] = [];
    const retryQueue: {voter: Voter, retries: number}[] = [];

    const processVoter = async (voter: Voter, serverIndex: number, retries: number = 0) => {
        const server = API_SERVERS[serverIndex % API_SERVERS.length];
        try {
            await updateFunction(voter, server);
            updateProgress(1, totalVoters);
        } catch (error) {
            if (retries < MAX_RETRIES) {
                const backoffTime = Math.min(INITIAL_BACKOFF * Math.pow(BACKOFF_MULTIPLIER, retries), MAX_BACKOFF);
                console.log(`Request failed for voter ${voter.owner}. Scheduling retry with next server in ${backoffTime}ms... (${retries + 1}/${MAX_RETRIES})`);
                retryQueue.push({voter, retries: retries + 1});
                setTimeout(() => processRetry(), backoffTime);
            } else {
                console.log(`Failed to process voter ${voter.owner} after all retries`);
                failedVoters.push(voter);
            }
        }
    };

    const processRetry = async () => {
        if (retryQueue.length > 0) {
            const {voter, retries} = retryQueue.shift()!;
            const nextServerIndex = retries % API_SERVERS.length;
            await processVoter(voter, nextServerIndex, retries);
        }
    };

    const initialPromises = voters.map((voter, index) => processVoter(voter, index));
    await Promise.all(initialPromises);

    // Wait for all retries to complete
    while (retryQueue.length > 0) {
        await sleep(100); // Small delay to prevent busy-waiting
    }

    return failedVoters;
}

async function processVoters(voters: Voter[], updateFunction: (voter: Voter, server: string) => Promise<void>, updateProgress: (current: number, total: number) => void, functionName: string): Promise<void> {
    console.log(`Starting to ${functionName} for ${voters.length} voters`);
    let processedCount = 0;
    let remainingVoters = [...voters];

    while (remainingVoters.length > 0) {
        const batch = remainingVoters.slice(0, API_SERVERS.length);
        console.log(`Processing batch of ${batch.length} voters`);

        const failedVoters = await processBatch(batch, updateFunction, (current, total) => {
            processedCount += current;
            updateProgress(processedCount, voters.length);
        }, voters.length);

        if (failedVoters.length > 0) {
            console.error(`Failed to process ${failedVoters.length} voters after all retries. Stopping the process.`);
            throw new Error(`Failed to process voters in ${functionName}`);
        }

        remainingVoters = remainingVoters.slice(API_SERVERS.length);
    }

    console.log(`Finished ${functionName} for all voters`);
}

export async function updateFioPublicKeys(voters: Voter[], updateProgress: (current: number, total: number) => void): Promise<void> {
    const updateVoterFioPublicKey = async (voter: Voter, server: string) => {
        const response = await axios.post(`${server}/v1/chain/get_table_rows`, {
            json: true,
            code: "fio.address",
            scope: "fio.address",
            table: "accountmap",
            limit: "1",
            upper_bound: voter.owner,
            lower_bound: voter.owner
        }, { timeout: TIMEOUT });

        const rows = response.data.rows;
        if (rows.length > 0 && rows[0].account === voter.owner) {
            voter.fio_public_key = rows[0].clientkey;
        } else {
            throw new Error(`No matching account found for ${voter.owner}`);
        }
    };

    await processVoters(voters, updateVoterFioPublicKey, updateProgress, "update FIO public keys");
}

export async function updateVoterBalances(voters: Voter[], updateProgress: (current: number, total: number) => void): Promise<void> {
    const updateVoterBalance = async (voter: Voter, server: string) => {
        const response = await axios.post(`${server}/v1/chain/get_fio_balance`, {
            fio_public_key: voter.fio_public_key
        }, { timeout: TIMEOUT });

        voter.balance = parseFloat(response.data.balance) / 1000000000;
        voter.available = parseFloat(response.data.available) / 1000000000;
    };

    await processVoters(voters, updateVoterBalance, updateProgress, "update voter balances");
}

export async function updateLockedTokens(voters: Voter[], updateProgress: (current: number, total: number) => void): Promise<void> {
    const updateVoterLockedTokens = async (voter: Voter, server: string) => {
        const response = await axios.post(`${server}/v1/chain/get_table_rows`, {
            json: true,
            code: 'eosio',
            scope: 'eosio',
            table: 'lockedtokens',
            lower_bound: voter.owner,
            upper_bound: voter.owner
        }, { timeout: TIMEOUT });

        if (response.data.rows.length > 0 && response.data.rows[0].grant_type === 4) {
            voter.locked4 = parseFloat(response.data.rows[0].remaining_locked_amount) / 1000000000;
        } else {
            voter.locked4 = 0;
        }
    };

    await processVoters(voters, updateVoterLockedTokens, updateProgress, "update locked tokens");
}

export function updateCalculatedTotals(voters: Voter[]): void {
    for (const voter of voters) {
        voter.correct_last_vote_weight = voter.balance - voter.locked4;
        voter.wrong_last_vote_weight = voter.proxy ? voter.balance - voter.locked4 : voter.available;
    }
}

export function updateProxiedVotes(voters: Voter[]): void {
    const voterMap = new Map(voters.map(voter => [voter.owner, voter]));

    for (const voter of voters) {
        if (voter.proxy) {
            const proxy = voterMap.get(voter.proxy);
            if (proxy) {
                proxy.correct_proxied_vote_weight += voter.correct_last_vote_weight;
                proxy.wrong_proxied_vote_weight += voter.wrong_last_vote_weight;
                // Only update calculated_last_vote_weight if the proxy is active (is_proxy === 1)
                if (proxy.is_proxy === 1) {
                    proxy.correct_last_vote_weight += voter.correct_last_vote_weight;
                    proxy.wrong_last_vote_weight += voter.wrong_last_vote_weight;
                }
            }
        }
    }
}

export async function fetchProducers(): Promise<Producer[]> {
    for (const server of API_SERVERS) {
        try {
            const response = await retryRequest(() =>
                axios.post(`${server}/v1/chain/get_producers`, {
                    json: true,
                    limit: 1000 // Adjust this if there might be more producers
                }, { timeout: TIMEOUT })
            );

            return response.data.producers.map((producer: any) => ({
                ...producer,
                total_votes: parseFloat(producer.total_votes) / 1000000000,
                correct_total_votes: 0,
                wrong_total_votes: 0
            }));
        } catch (error) {
            console.error(`Failed to fetch producers from server ${server}:`, error);
        }
    }
    throw new Error("Failed to fetch producers from all servers");
}

export function calculateProducerVotes(voters: Voter[], producers: Producer[]): void {
    const producerMap = new Map(producers.map(producer => [producer.owner, producer]));

    for (const voter of voters) {
        for (const producerOwner of voter.producers) {
            const producer = producerMap.get(producerOwner);
            if (producer) {
                producer.correct_total_votes += voter.correct_last_vote_weight;
                producer.wrong_total_votes += voter.wrong_last_vote_weight;
            }
        }
    }
}