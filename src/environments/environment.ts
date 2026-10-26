const getApiUrl = (): string => {
    if (typeof window === 'undefined') return '';
    return (window as any).__ENV__?.API_URL || 'http://localhost:8001';
};

const getWsUrl = (): string => {
    if (typeof window === 'undefined') return '';
    if ((window as any).__ENV__?.WS_URL) return (window as any).__ENV__.WS_URL;
    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${wsProto}//${window.location.host}`;
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
        endpointing: 3000,
        utterance_end_ms: 1200
    } as DeepgramOptions
};