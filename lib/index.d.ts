import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
export declare const name = "air-outer-relay";
export declare const inject: string[];
export declare const SETTINGS_NAMESPACE: import("@deepseek-ai/dsh-settings").SettingsNamespace;
export interface Config {
    enabled?: boolean;
    host?: string;
    port?: number;
    upstream?: string;
    apiKeyEnv?: string;
    timeoutMs?: number;
    maxBodyBytes?: number;
    verbose?: boolean;
}
export declare const Config: z<Config>;
export declare function apply(ctx: Context, config?: Config): void;
export { AirOuterRelay } from './relay.js';
export type { RelayAddress, RelayLogger, RelayOptions } from './relay.js';
//# sourceMappingURL=index.d.ts.map