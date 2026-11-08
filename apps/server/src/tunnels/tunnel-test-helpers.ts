import type { CloudflareFetch } from './cloudflare-api.ts';
import type { CloudflareTokenStore } from './cloudflare-token-store.ts';
import type { CloudflaredProcess, CloudflaredRunner } from './cloudflared-runner.ts';

export interface FakeAnswer {
    code?: number;
    lines?: string[];
}

/*
 * A `cloudflared` that runs nothing. `run` stays alive until it is stopped, like the real child; it keeps the
 * environment each start got, so a test can check what reached the process and what did not.
 */
export class FakeCloudflared implements CloudflaredRunner {
    readonly calls: string[][] = [];
    readonly environments: Array<Readonly<Record<string, string>>> = [];
    readonly answers = new Map<string, FakeAnswer>();
    running = 0;
    private readonly ends: Array<(code: number) => void> = [];

    answer(key: string, answer: FakeAnswer): void {
        this.answers.set(key, answer);
    }

    /* Ends the child the way a crash does. */
    crash(code = 1): void {
        this.ends.splice(0).forEach((end) => end(code));
    }

    start(_binary: string, args: readonly string[], onLine: (line: string) => void, env: Readonly<Record<string, string>> = {}): CloudflaredProcess {
        this.calls.push([...args]);
        this.environments.push({ ...env });

        const answer = this.answers.get(args.includes('run') ? 'run' : args.join(' ')) ?? {};

        this.running += 1;
        answer.lines?.forEach(onLine);

        let end: (code: number) => void = () => undefined;
        const exited = new Promise<number>((resolve) => {
            end = resolve;
            this.ends.push(resolve);
        });
        void exited.then(() => {
            this.running -= 1;
        });

        return { exited, stop: () => end(0) };
    }

    /* The calls whose arguments include these words. */
    called(...words: string[]): string[][] {
        return this.calls.filter((call) => words.every((word) => call.includes(word)));
    }
}

/* A token store in memory, which is how a test runs the service without a disk. */
export class MemoryTokenStore implements CloudflareTokenStore {
    private token: string | null;

    constructor(token: string | null = null) {
        this.token = token;
    }

    read(): string | null {
        return this.token;
    }

    async write(token: string): Promise<void> {
        this.token = token;
    }

    async clear(): Promise<void> {
        this.token = null;
    }
}

export interface FakeZone {
    id: string;
    name: string;
    account: { id: string; name: string };
}

export interface FakeRecord {
    id: string;
    zone: string;
    type: string;
    name: string;
    content: string;
    proxied: boolean;
    comment: string | null;
}

export interface FakeTunnel {
    id: string;
    account: string;
    name: string;
    ingress: Array<Record<string, unknown>>;
}

export interface FakeCall {
    method: string;
    path: string;
    body: unknown;
    authorization: string | null;
}

export const FAKE_API_TOKEN = 'cf-api-token-0123456789-secret';
export const FAKE_RUN_TOKEN = 'eyJhIjoicnVuLXRva2VuLXNlY3JldCJ9';

/*
 * The part of Cloudflare's v4 API Tunnels use, answered from memory. A test hands `fetch` to the service and reads
 * `calls`, `records` and `tunnels` afterwards; nothing here touches a network. A request with another token than
 * `acceptedToken` answers 401, and one to a host other than `api.cloudflare.com` fails the test.
 */
export class FakeCloudflare {
    readonly calls: FakeCall[] = [];
    readonly zones: FakeZone[] = [];
    readonly records: FakeRecord[] = [];
    readonly tunnels: FakeTunnel[] = [];
    acceptedToken = FAKE_API_TOKEN;
    /* Paths (method and path start) answered with a status, to make Cloudflare refuse one thing. */
    readonly failing = new Map<string, number>();
    private counter = 0;

    readonly fetch: CloudflareFetch = async (url, init) => {
        const parsed = new URL(url);

        if (parsed.host !== 'api.cloudflare.com') {
            throw new Error(`The fake Cloudflare was asked for ${parsed.host}`);
        }

        const method = init.method ?? 'GET';
        const path = parsed.pathname.replace('/client/v4', '');
        const headers = new Headers(init.headers);
        const body = typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;

        this.calls.push({ method, path: `${path}${parsed.search}`, body, authorization: headers.get('authorization') });

        if (headers.get('authorization') !== `Bearer ${this.acceptedToken}`) {
            return this.fail(401, 'Invalid API Token');
        }

        for (const [key, status] of this.failing) {
            if (`${method} ${path}`.startsWith(key)) {
                return this.fail(status, 'Fake failure');
            }
        }

        return this.route(method, path, parsed.searchParams, body);
    };

    zone(name: string, account = { id: 'acc-1', name: 'Bas' }): FakeZone {
        const zone = { id: `zone-${name}`, name, account };

        this.zones.push(zone);

        return zone;
    }

    record(zone: FakeZone, input: Partial<FakeRecord> & { name: string }): FakeRecord {
        return this.addRecord(zone.id, input);
    }

    private addRecord(zone: string, input: Partial<FakeRecord> & { name: string }): FakeRecord {
        this.counter += 1;

        const record: FakeRecord = { id: `rec-${this.counter}`, zone, type: 'A', content: '203.0.113.9', proxied: false, comment: null, ...input };

        this.records.push(record);

        return record;
    }

    /* A tunnel that already sits on the account, made by something other than Ruimte. */
    tunnel(account: string, name: string, ingress: Array<Record<string, unknown>> = [{ service: 'http_status:404' }]): FakeTunnel {
        this.counter += 1;

        const tunnel = { id: `00000000-0000-4000-8000-${String(this.counter).padStart(12, '0')}`, account, name, ingress };

        this.tunnels.push(tunnel);

        return tunnel;
    }

    called(method: string, pathStart: string): FakeCall[] {
        return this.calls.filter((call) => call.method === method && call.path.startsWith(pathStart));
    }

    private fail(status: number, message: string): Response {
        return Response.json({ success: false, errors: [{ code: status, message }], messages: [], result: null }, { status });
    }

    private ok(result: unknown): Response {
        return Response.json({ success: true, errors: [], messages: [], result, result_info: { total_pages: 1 } });
    }

    private route(method: string, path: string, query: URLSearchParams, body: unknown): Response {
        if (method === 'GET' && path === '/user/tokens/verify') {
            return this.ok({ id: 'token-1', status: 'active' });
        }

        if (method === 'GET' && path === '/zones') {
            return this.ok(this.zones);
        }

        const tunnels = /^\/accounts\/([^/]+)\/cfd_tunnel(?:\/([^/]+)(?:\/(token|configurations))?)?$/.exec(path);

        if (tunnels !== null) {
            return this.routeTunnel(method, tunnels[1]!, tunnels[2], tunnels[3], query, body);
        }

        const dns = /^\/zones\/([^/]+)\/dns_records(?:\/([^/]+))?$/.exec(path);

        if (dns !== null) {
            return this.routeRecord(method, dns[1]!, dns[2], query, body);
        }

        return this.fail(404, `No such path ${path}`);
    }

    private routeTunnel(method: string, account: string, id: string | undefined, part: string | undefined, query: URLSearchParams, body: unknown): Response {
        if (id === undefined) {
            if (method === 'GET') {
                return this.ok(
                    this.tunnels.filter((tunnel) => tunnel.account === account && tunnel.name === query.get('name')).map(({ id, name }) => ({ id, name }))
                );
            }

            const input = body as { name: string; config_src: string };

            if (input.config_src !== 'cloudflare') {
                return this.fail(400, 'Tunnels from Ruimte are managed in Cloudflare');
            }

            const made = this.tunnel(account, input.name, []);

            return this.ok({ id: made.id, name: made.name });
        }

        const tunnel = this.tunnels.find((candidate) => candidate.account === account && candidate.id === id);

        if (tunnel === undefined) {
            return this.fail(404, 'Tunnel not found');
        }

        if (part === 'token') {
            return this.ok(FAKE_RUN_TOKEN);
        }

        if (part === 'configurations') {
            if (method === 'PUT') {
                tunnel.ingress = (body as { config: { ingress: Array<Record<string, unknown>> } }).config.ingress;
            }

            return this.ok({ config: { ingress: tunnel.ingress } });
        }

        return this.ok({ id: tunnel.id, name: tunnel.name });
    }

    private routeRecord(method: string, zone: string, id: string | undefined, query: URLSearchParams, body: unknown): Response {
        if (method === 'GET') {
            return this.ok(this.records.filter((record) => record.zone === zone && record.name === query.get('name')));
        }

        if (method === 'POST') {
            const input = body as Omit<FakeRecord, 'id' | 'zone'>;

            return this.ok(this.addRecord(zone, input));
        }

        const index = this.records.findIndex((record) => record.zone === zone && record.id === id);

        if (index < 0) {
            return this.fail(404, 'Record not found');
        }

        if (method === 'DELETE') {
            this.records.splice(index, 1);

            return this.ok({ id });
        }

        this.records[index] = { ...this.records[index]!, ...(body as object) };

        return this.ok(this.records[index]);
    }
}
