// src/types.ts
export interface Voter {
    id: number;
    fioaddress: string;
    owner: string;
    proxy: string;
    producers: string[];
    last_vote_weight: number;
    proxied_vote_weight: number;
    is_proxy: number;
    is_auto_proxy: number;
    balance: number;
    available: number;
    locked4: number;
    fio_public_key: string;
    correct_last_vote_weight: number;
    wrong_last_vote_weight: number;
    correct_proxied_vote_weight: number;
    wrong_proxied_vote_weight: number;
}

export interface ProcessingStatus {
    stage: string;
    balanceStatus: {
        current: number;
        total: number;
    };
    lockedTokensStatus: {
        current: number;
        total: number;
    };
    fioPublicKeyStatus: {
        current: number;
        total: number;
    };
}

export interface Producer {
    id: number;
    owner: string;
    fio_address: string;
    total_votes: number;
    correct_total_votes: number;
    wrong_total_votes: number;
}