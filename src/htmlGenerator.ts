// src/htmlGenerator.ts
import { Voter, Producer, ProcessingStatus } from './types';

function formatNumber(value: number): string {
    return value.toFixed(9);
}

export function generateHTML(voters: Voter[], producers: Producer[], status: ProcessingStatus): string {
    const voterTableRows = generateVoterTableRows(voters);
    const producerTableRows = generateProducerTableRows(producers);

    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>FIO Voter and Producer Data</title>
            <style>
                table { border-collapse: collapse; width: 100%; margin-bottom: 20px; }
                th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                tr:nth-child(even) { background-color: #f2f2f2; }
                tr.highlight { background-color: yellow !important; }
                #status { margin-bottom: 20px; font-weight: bold; }
                #processButton { margin-bottom: 20px; }
            </style>
        </head>
        <body>
            <h1>FIO Voter and Producer Data</h1>
            <button id="processButton">Process Data</button>
            <div id="status">
                Stage: ${status.stage}<br>
                Balance Update: ${status.balanceStatus.current}/${status.balanceStatus.total}<br>
                Locked Tokens Update: ${status.lockedTokensStatus.current}/${status.lockedTokensStatus.total}
            </div>
            
            <h2>Voters</h2>
            <div id="voterTable">
                <table>
                    <tr>
                        <th>ID</th>
                        <th>FIO Address</th>
                        <th>Owner</th>
                        <th>Proxy</th>
                        <th>Producers</th>
                        <th>Last Vote Weight</th>
                        <th>Proxied Vote Weight</th>
                        <th>Is Proxy</th>
                        <th>Is Auto Proxy</th>
                        <th>Balance</th>
                        <th>Locked</th>
                        <th>Calculated Last Vote Weight</th>
                        <th>Calculated Proxied Vote Weight</th>
                    </tr>
                    ${voterTableRows}
                </table>
            </div>

            <h2>Producers</h2>
            <div id="producerTable">
                <table>
                    <tr>
                        <th>Owner</th>
                        <th>FIO Address</th>
                        <th>Total Votes</th>
                        <th>Calculated Total Votes</th>
                    </tr>
                    ${producerTableRows}
                </table>
            </div>

            <script>
                document.getElementById('processButton').addEventListener('click', function() {
                    this.disabled = true;
                    fetch('/api/process', { method: 'POST' })
                        .then(response => {
                            if (!response.ok) {
                                throw new Error('Network response was not ok');
                            }
                            updateStatus();
                        })
                        .catch(error => {
                            console.error('Error:', error);
                            document.getElementById('status').textContent = 'Error: ' + error.message;
                            this.disabled = false;
                        });
                });

                function updateStatus() {
                    fetch('/api/status')
                        .then(response => response.json())
                        .then(status => {
                            document.getElementById('status').innerHTML = 
                                \`Stage: \${status.stage}<br>
                                Balance Update: \${status.balanceStatus.current}/\${status.balanceStatus.total}<br>
                                Locked Tokens Update: \${status.lockedTokensStatus.current}/\${status.lockedTokensStatus.total}\`;
                            if (status.stage !== 'Complete' && status.stage !== '') {
                                setTimeout(updateStatus, 1000);
                            } else if (status.stage === 'Complete') {
                                location.reload();
                            } else {
                                document.getElementById('processButton').disabled = false;
                            }
                        })
                        .catch(error => {
                            console.error('Error:', error);
                            document.getElementById('status').textContent = 'Error: ' + error.message;
                            document.getElementById('processButton').disabled = false;
                        });
                }
            </script>
        </body>
        </html>
    `;
}

function generateVoterTableRows(voters: Voter[]): string {
    return voters.map(voter => `
        <tr class="${isVoterHighlighted(voter) ? 'highlight' : ''}">
            <td>${voter.id}</td>
            <td>${voter.fioaddress}</td>
            <td>${voter.owner}</td>
            <td>${voter.proxy}</td>
            <td>${voter.producers.join(', ')}</td>
            <td>${formatNumber(voter.last_vote_weight)}</td>
            <td>${formatNumber(voter.proxied_vote_weight)}</td>
            <td>${voter.is_proxy}</td>
            <td>${voter.is_auto_proxy}</td>
            <td>${formatNumber(voter.balance)}</td>
            <td>${formatNumber(voter.locked)}</td>
            <td>${formatNumber(voter.calculated_last_vote_weight)}</td>
            <td>${formatNumber(voter.calculated_proxied_vote_weight)}</td>
        </tr>
    `).join('');
}

function generateProducerTableRows(producers: Producer[]): string {
    return producers.map(producer => `
        <tr class="${isProducerHighlighted(producer) ? 'highlight' : ''}">
            <td>${producer.owner}</td>
            <td>${producer.fio_address}</td>
            <td>${formatNumber(producer.total_votes)}</td>
            <td>${formatNumber(producer.calculated_total_votes)}</td>
        </tr>
    `).join('');
}

function isVoterHighlighted(voter: Voter): boolean {
    return Math.abs(voter.calculated_last_vote_weight - voter.last_vote_weight) > 1 ||
        Math.abs(voter.calculated_proxied_vote_weight - voter.proxied_vote_weight) > 1;
}

function isProducerHighlighted(producer: Producer): boolean {
    return Math.abs(producer.calculated_total_votes - producer.total_votes) > 1;
}