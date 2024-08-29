import axios from 'axios';
import { Voter, Producer } from './types';
import { API_SERVERS } from './config';

const MAX_RETRIES = 5;
const INITIAL_BACKOFF = 1000; // 1 second
const MAX_BACKOFF = 5000; // 5 seconds
const TIMEOUT = 5000; // 3 seconds

async function retryRequest(fn: () => Promise<any>, retries: number = 0): Promise<any> {
    try {
        return await fn();
    } catch (error) {
        if (retries >= MAX_RETRIES) {
            throw error;
        }
        const backoff = Math.min(INITIAL_BACKOFF * Math.pow(2, retries), MAX_BACKOFF);
        console.log(`Request failed. Retrying in ${backoff}ms... (${retries + 1}/${MAX_RETRIES})`);
        await new Promise(resolve => setTimeout(resolve, backoff));
        return retryRequest(fn, retries + 1);
    }
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
                locked: 0,
                calculated_last_vote_weight: 0,
                calculated_proxied_vote_weight: 0
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

async function processBatch(voters: Voter[], updateFunction: (voter: Voter, server: string) => Promise<void>, updateProgress: (current: number, total: number) => void, totalVoters: number): Promise<Voter[]> {
    const failedVoters: Voter[] = [];
    const promises = voters.map((voter, index) => {
        const server = API_SERVERS[index];
        return updateFunction(voter, server)
            .then(() => {
                updateProgress(1, totalVoters);
                return null;
            })
            .catch((error) => {
                console.error(`${server} errored`);
                return voter;
            });
    });

    const results = await Promise.allSettled(promises);
    results.forEach((result, index) => {
        if (result.status === 'rejected' || (result.status === 'fulfilled' && result.value !== null)) {
            failedVoters.push(voters[index]);
        }
    });

    return failedVoters;
}

export async function updateVoterBalances(voters: Voter[], updateProgress: (current: number, total: number) => void): Promise<void> {
    console.log(`Starting to update balances for ${voters.length} voters`);
    let processedCount = 0;
    let remainingVoters = [...voters];

    const updateVoterBalance = async (voter: Voter, server: string) => {
        const response = await axios.post(`${server}/v1/chain/get_currency_balance`, {
            code: 'fio.token',
            account: voter.owner,
            symbol: 'FIO'
        }, { timeout: TIMEOUT });

        if (response.data.length > 0) {
            voter.balance = parseFloat(response.data[0].split(' ')[0]);
            voter.calculated_last_vote_weight = voter.balance;
        }
    };

    while (remainingVoters.length > 0) {
        const batchSize = Math.min(API_SERVERS.length, remainingVoters.length);
        const batch = remainingVoters.slice(0, batchSize);

        console.log(`Processing batch of ${batch.length} voters`);
        const failedVoters = await processBatch(batch, updateVoterBalance, (current, total) => {
            processedCount += current;
            updateProgress(processedCount, total);
        }, voters.length);

        remainingVoters = failedVoters.concat(remainingVoters.slice(batchSize));
    }

    console.log('Finished updating all voter balances');
}

export async function updateLockedTokens(voters: Voter[], updateProgress: (current: number, total: number) => void): Promise<void> {
    console.log(`Starting to update locked tokens for ${voters.length} voters`);
    let processedCount = 0;
    let remainingVoters = [...voters];

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
            voter.locked = parseFloat(response.data.rows[0].remaining_locked_amount) / 1000000000;
            voter.calculated_last_vote_weight = voter.balance - voter.locked;
        }
    };

    while (remainingVoters.length > 0) {
        const batchSize = Math.min(API_SERVERS.length, remainingVoters.length);
        const batch = remainingVoters.slice(0, batchSize);

        console.log(`Processing batch of ${batch.length} voters`);
        const failedVoters = await processBatch(batch, updateVoterLockedTokens, (current, total) => {
            processedCount += current;
            updateProgress(processedCount, total);
        }, voters.length);

        remainingVoters = failedVoters.concat(remainingVoters.slice(batchSize));
    }

    console.log('Finished updating all locked tokens');
}

export function updateProxiedVotes(voters: Voter[]): void {
    const voterMap = new Map(voters.map(voter => [voter.owner, voter]));

    for (const voter of voters) {
        if (voter.proxy) {
            const proxy = voterMap.get(voter.proxy);
            if (proxy) {
                proxy.calculated_proxied_vote_weight += voter.calculated_last_vote_weight;

                // Only update calculated_last_vote_weight if the proxy is active (is_proxy === 1)
                if (proxy.is_proxy === 1) {
                    proxy.calculated_last_vote_weight += voter.calculated_last_vote_weight;
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
                calculated_total_votes: 0
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
                producer.calculated_total_votes += voter.calculated_last_vote_weight;
            }
        }
    }
}