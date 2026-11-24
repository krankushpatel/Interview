const getApiUrl = (): string => {
    if (typeof window === 'undefined') return '';
    if ((window as any).__ENV__?.API_URL) return (window as any).__ENV__.API_URL;
    const hostname = window.location.hostname || 'localhost';
    const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
    const proto = window.location.protocol || 'http:';
    return isLocal ? `http://${hostname}:8001` : `${proto}//${hostname}`;
};

const getWsUrl = (): string => {
    if (typeof window === 'undefined') return '';
    if ((window as any).__ENV__?.WS_URL) return (window as any).__ENV__.WS_URL;
    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const hostname = window.location.hostname || 'localhost';
    const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
    return isLocal ? `${wsProto}//${hostname}:8001` : `${wsProto}//${hostname}`;
};



export interface DeepgramOptions {
    model?: string;
    tier?: string;
    smart_format?: boolean;
    punctuate?: boolean;
    keywords?: string[];
    keyword_boost?: number;
    endpointing?: number;
    utterance_end_ms?: number;
}

export const environment = {
    production: false,
    get apiUrl(): string {
        return getApiUrl();
    },
    get wsUrl(): string {
        return getWsUrl();
    },
    deepgramApiKey: 'backend-managed',
    deepgramOptions: {
        model: 'nova-3',
        tier: 'enhanced',
        smart_format: false,
        punctuate: true,
        keywords: [],
        keyword_boost: 4.0,
        endpointing: 200,
        utterance_end_ms: 1000
    } as DeepgramOptions
};