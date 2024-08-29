// src/config.ts
export const API_SERVERS = [
    'https://fio.acherontrading.com',
    'https://fio.eosdac.io',
    "https://fio.eosdublin.io",
    "https://fio.greymass.com",
    'https://api.fio.services',
    "https://api.fio.detroitledger.tech",
    'https://api.fio.alohaeos.com',
    'https://fio.eos.barcelona',
    'https://api.fiosweden.org',
    "https://fio.eosusa.io",
    'https://fio.eu.eosamsterdam.net',
    'https://api.fio.currencyhub.io',
    'https://fio.eosrio.io',
    'https://fio.blockpane.com',
    "https://api.fio.greeneosio.com",
    'https://api-fio.nodeone.network:8344',
    "https://fio.cryptolions.io",
    "https://fio.eosphere.io",
    "https://fio.eosargentina.io"
];

export function getRandomServer(): string {
    return API_SERVERS[Math.floor(Math.random() * API_SERVERS.length)];
}