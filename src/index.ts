import express from 'express';
import { Voter, Producer, ProcessingStatus } from './types';
import { fetchVoters, updateFioPublicKeys, updateVoterBalances, updateLockedTokens, updateCalculatedTotals, updateProxiedVotes, fetchProducers, calculateProducerVotes } from './processors';
import { generateHTML } from './htmlGenerator';

const app = express();
const port = 3000;

let processedVoters: Voter[] = [];
let processedProducers: Producer[] = [];
let processingStatus: ProcessingStatus = {
    stage: '',
    balanceStatus: { current: 0, total: 0 },
    lockedTokensStatus: { current: 0, total: 0 },
    fioPublicKeyStatus: { current: 0, total: 0 }
};

app.get('/', (req, res) => {
    res.send(generateHTML(processedVoters, processedProducers, processingStatus));
});

app.get('/api/status', (req, res) => {
    res.json(processingStatus);
});

app.post('/api/process', async (req, res) => {
    if (processingStatus.stage !== '' && processingStatus.stage !== 'Complete') {
        return res.status(409).json({ error: 'Processing already in progress' });
    }
    processData();
    res.status(202).json({ message: 'Processing started' });
});

async function processData() {
    try {
        processingStatus = {
            stage: 'Fetching voters',
            balanceStatus: { current: 0, total: 0 },
            lockedTokensStatus: { current: 0, total: 0 },
            fioPublicKeyStatus: { current: 0, total: 0 }
        };
        console.log("Fetching voters...");
        const voters = await fetchVoters();
        console.log(`Fetched ${voters.length} voters`);

        processingStatus.stage = 'Updating FIO public keys';
        processingStatus.fioPublicKeyStatus.total = voters.length;
        processingStatus.fioPublicKeyStatus.current = 0;
        console.log("Updating FIO public keys...");
        await updateFioPublicKeys(voters, (current, total) => {
            processingStatus.fioPublicKeyStatus.current = current;
            console.log(`FIO public key update progress: ${current}/${total}`);
        });
        console.log("Finished updating FIO public keys");

        processingStatus.stage = 'Updating balances';
        processingStatus.balanceStatus.total = voters.length;
        processingStatus.balanceStatus.current = 0;
        console.log("Updating voter balances...");
        await updateVoterBalances(voters, (current, total) => {
            processingStatus.balanceStatus.current = current;
            console.log(`Balance update progress: ${current}/${total}`);
        });
        console.log("Finished updating voter balances");

        processingStatus.stage = 'Updating locked tokens';
        processingStatus.lockedTokensStatus.total = voters.length;
        processingStatus.lockedTokensStatus.current = 0;
        console.log("Updating locked tokens...");
        await updateLockedTokens(voters, (current, total) => {
            processingStatus.lockedTokensStatus.current = current;
            console.log(`Locked tokens update progress: ${current}/${total}`);
        });
        console.log("Finished updating locked tokens");

        console.log("Updating calculated totals...");
        processingStatus.stage = 'Updating calculated totals';
        updateCalculatedTotals(voters);
        console.log("Finished updating calculated totals");

        console.log("Updating proxied votes...");
        processingStatus.stage = 'Updating proxied votes';
        updateProxiedVotes(voters);
        console.log("Finished updating proxied votes");

        console.log("Fetching producers...");
        processingStatus.stage = 'Fetching producers';
        const producers = await fetchProducers();
        console.log(`Fetched ${producers.length} producers`);

        console.log("Calculating producer votes...");
        processingStatus.stage = 'Calculating producer votes';
        calculateProducerVotes(voters, producers);
        console.log("Finished calculating producer votes");

        processedVoters = voters;
        processedProducers = producers;
        processingStatus.stage = 'Complete';
        console.log("Data processing complete.");
    } catch (error) {
        console.error("Error during data processing:", error);
        processingStatus.stage = 'Error';
    }
}

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});