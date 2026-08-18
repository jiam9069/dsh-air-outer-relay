import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings';
import z from '@deepseek-ai/schemastery';
import { AirOuterRelay } from './relay.js';
export const name = 'air-outer-relay';
export const inject = ['settings'];
export const SETTINGS_NAMESPACE = settingsNamespace('air-outer-relay');
export const Config = z.object({
    enabled: z.boolean().default(true),
    host: z.string().default('127.0.0.1'),
    port: z.number().min(0).max(65535).default(8788),
    upstream: z.string().default('https://ps.air-outer.com'),
    apiKeyEnv: z.string().default('AIR_OUTER_API_KEY'),
    timeoutMs: z.number().min(1000).max(3600000).default(600000),
    maxBodyBytes: z.number().min(1024).max(67108864).default(8388608),
    verbose: z.boolean().default(false),
});
export function apply(ctx, config = {}) {
    let current = () => Config(config);
    let relay;
    const start = async () => {
        const resolved = Config(current());
        if (!resolved.enabled)
            return;
        relay = new AirOuterRelay({
            host: resolved.host, port: resolved.port, upstream: resolved.upstream,
            apiKeyEnv: resolved.apiKeyEnv, timeoutMs: resolved.timeoutMs,
            maxBodyBytes: resolved.maxBodyBytes, verbose: resolved.verbose,
            logger: ctx.logger,
        });
        const address = await relay.start();
        ctx.logger.info(`air-outer relay listening at ${address.baseURL}`);
    };
    installSettingsSection(ctx, SETTINGS_NAMESPACE, Config, config, {
        setSource: (source) => { current = source; },
        onChange: () => { ctx.logger.warn('air-outer-relay settings changed; restart DSH to apply listener changes'); },
    });
    ctx.effect(async () => {
        await start();
        return async () => { await relay?.close(); };
    }, 'air-outer-relay server');
}
export { AirOuterRelay } from './relay.js';
//# sourceMappingURL=index.js.map