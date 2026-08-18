export interface RelayLogger {
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
    debug?(message: string): void;
}
export interface RelayOptions {
    host: string;
    port: number;
    upstream: string;
    apiKeyEnv: string;
    timeoutMs: number;
    maxBodyBytes: number;
    verbose: boolean;
    logger?: RelayLogger;
    fetchImpl?: typeof fetch;
    environment?: NodeJS.ProcessEnv;
}
export interface RelayAddress {
    host: string;
    port: number;
    baseURL: string;
}
interface Fingerprint {
    name: string;
    headers: Record<string, string>;
}
export declare const fingerprints: {
    CLAUDE: Fingerprint;
    CODEX_RS: Fingerprint;
    CODEX_SDK: Fingerprint;
    OPENAI_SDK: Fingerprint;
};
export declare class AirOuterRelay {
    #private;
    constructor(options: RelayOptions);
    start(): Promise<RelayAddress>;
    close(): Promise<void>;
}
export {};
//# sourceMappingURL=relay.d.ts.map