import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
const CLAUDE = {
    name: 'claude-cli',
    headers: {
        'user-agent': 'claude-cli/2.1.137 (external, sdk-cli)',
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'prompt-caching-2024-07-31, pdfs-2024-09-24',
    },
};
const CODEX_RS = {
    name: 'codex_cli_rs',
    headers: {
        'user-agent': 'codex_cli_rs/0.104.0 (Linux; x86_64) terminal',
        originator: 'codex_cli_rs',
        version: '0.104.0',
    },
};
const CODEX_SDK = {
    name: 'codex-sdk',
    headers: {
        'user-agent': 'codex-cli/0.104.0 (external, sdk-cli)',
        originator: 'codex_cli_rs',
    },
};
const OPENAI_SDK = {
    name: 'openai-sdk',
    headers: {
        'user-agent': 'OpenAI/NodeJS/4.104.0',
        'openai-beta': 'responses=v1',
        'x-stainless-lang': 'js',
        'x-stainless-package-version': '4.104.0',
    },
};
export const fingerprints = { CLAUDE, CODEX_RS, CODEX_SDK, OPENAI_SDK };
const AUTH_MARKERS = [
    'unauthorized client', 'api key is invalid', 'invalid api key',
    'unauthorized', 'forbidden', 'client detected',
];
function isAuthFailure(status, text) {
    if (status === 401 || status === 403)
        return true;
    if (status < 400)
        return false;
    const lower = text.toLowerCase();
    return AUTH_MARKERS.some((marker) => lower.includes(marker));
}
function modelFrom(body) {
    if (body.length === 0)
        return undefined;
    try {
        const value = JSON.parse(body.toString('utf8'));
        return typeof value.model === 'string' ? value.model : undefined;
    }
    catch {
        return undefined;
    }
}
function candidateList(model) {
    return model?.toLowerCase().includes('claude')
        ? [CLAUDE, CODEX_RS, CODEX_SDK, OPENAI_SDK]
        : [CODEX_RS, CODEX_SDK, OPENAI_SDK, CLAUDE];
}
function fingerprintHeaders(fp) {
    const headers = { ...fp.headers };
    if (fp === CODEX_RS)
        headers.session_id = randomUUID();
    return headers;
}
function requestBody(req, maxBytes) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > maxBytes) {
                reject(Object.assign(new Error(`request body exceeds ${maxBytes} bytes`), { statusCode: 413 }));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}
function normalizedUpstream(value) {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:')
        throw new TypeError('upstream must use http or https');
    url.pathname = url.pathname.replace(/\/$/, '');
    return url;
}
function clientHeaders(source, authorization) {
    const headers = new Headers();
    headers.set('authorization', authorization);
    headers.set('content-type', source['content-type'] ?? 'application/json');
    headers.set('accept', source.accept ?? 'application/json');
    return headers;
}
async function writeWebResponse(response, res) {
    res.statusCode = response.status;
    res.setHeader('content-type', response.headers.get('content-type') ?? 'application/json');
    res.setHeader('access-control-allow-origin', '*');
    if (response.body === null) {
        res.end();
        return;
    }
    const reader = response.body.getReader();
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            if (!res.write(Buffer.from(value)))
                await new Promise((resolve) => res.once('drain', resolve));
        }
        res.end();
    }
    catch (error) {
        res.destroy(error instanceof Error ? error : new Error(String(error)));
    }
    finally {
        reader.releaseLock();
    }
}
export class AirOuterRelay {
    #options;
    #upstream;
    #fetch;
    #env;
    #cache = new Map();
    #server;
    constructor(options) {
        this.#options = options;
        this.#upstream = normalizedUpstream(options.upstream);
        this.#fetch = options.fetchImpl ?? fetch;
        this.#env = options.environment ?? process.env;
    }
    async start() {
        if (this.#server)
            throw new Error('relay is already started');
        this.#server = createServer((req, res) => void this.#handle(req, res));
        await new Promise((resolve, reject) => {
            this.#server.once('error', reject);
            this.#server.listen(this.#options.port, this.#options.host, () => {
                this.#server.off('error', reject);
                resolve();
            });
        });
        const address = this.#server.address();
        if (address === null || typeof address === 'string')
            throw new Error('relay did not obtain a TCP address');
        return { host: this.#options.host, port: address.port, baseURL: `http://${this.#options.host}:${address.port}/v1` };
    }
    async close() {
        const server = this.#server;
        this.#server = undefined;
        if (!server)
            return;
        await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
    async #handle(req, res) {
        try {
            if (req.method === 'OPTIONS') {
                res.writeHead(204, {
                    'access-control-allow-origin': '*',
                    'access-control-allow-methods': 'GET, POST, OPTIONS',
                    'access-control-allow-headers': 'Authorization, Content-Type',
                }).end();
                return;
            }
            if (req.method !== 'GET' && req.method !== 'POST') {
                res.writeHead(405, { allow: 'GET, POST, OPTIONS' }).end();
                return;
            }
            const body = await requestBody(req, this.#options.maxBodyBytes);
            const authorization = req.headers.authorization
                ?? (this.#env[this.#options.apiKeyEnv] ? `Bearer ${this.#env[this.#options.apiKeyEnv]}` : undefined);
            if (!authorization) {
                this.#jsonError(res, 401, `missing Authorization and ${this.#options.apiKeyEnv}`);
                return;
            }
            const model = modelFrom(body);
            const cached = model ? this.#cache.get(model) : undefined;
            const candidates = cached ? [cached] : candidateList(model);
            const target = new URL(req.url ?? '/', this.#upstream);
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), this.#options.timeoutMs);
            try {
                for (const [index, fp] of candidates.entries()) {
                    const headers = clientHeaders(req.headers, authorization);
                    const injected = fingerprintHeaders(fp);
                    for (const [key, value] of Object.entries(injected))
                        headers.set(key, value);
                    if (this.#options.verbose)
                        this.#options.logger?.debug?.(`air-outer: ${model ?? 'unknown'} try ${fp.name}`);
                    const upstream = await this.#fetch(target, {
                        method: req.method,
                        headers,
                        body: body.length > 0 ? new Uint8Array(body) : undefined,
                        signal: controller.signal,
                    });
                    if (upstream.status < 400) {
                        if (model)
                            this.#cache.set(model, fp);
                        this.#options.logger?.info(`air-outer: ${model ?? 'unknown'} accepted fingerprint ${fp.name}`);
                        await writeWebResponse(upstream, res);
                        return;
                    }
                    const payload = Buffer.from(await upstream.arrayBuffer());
                    const text = payload.toString('utf8');
                    this.#options.logger?.warn(`air-outer: fingerprint ${fp.name} returned ${upstream.status}: ${text.slice(0, 240)}`);
                    if (!isAuthFailure(upstream.status, text) || index === candidates.length - 1) {
                        res.writeHead(upstream.status, {
                            'content-type': upstream.headers.get('content-type') ?? 'application/json',
                            'content-length': payload.length,
                            'access-control-allow-origin': '*',
                        }).end(payload);
                        return;
                    }
                }
            }
            finally {
                clearTimeout(timer);
            }
        }
        catch (error) {
            const code = typeof error === 'object' && error !== null && 'statusCode' in error ? Number(error.statusCode) : 502;
            this.#options.logger?.error(`air-outer relay error: ${String(error)}`);
            if (!res.headersSent)
                this.#jsonError(res, code, error instanceof Error ? error.message : String(error));
            else
                res.destroy();
        }
    }
    #jsonError(res, status, message) {
        const body = Buffer.from(JSON.stringify({ error: { type: 'relay_error', message } }));
        res.writeHead(status, { 'content-type': 'application/json', 'content-length': body.length }).end(body);
    }
}
//# sourceMappingURL=relay.js.map