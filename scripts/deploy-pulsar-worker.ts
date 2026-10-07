import { createHash, randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

const WORKER_ROOT = resolve(import.meta.dir, '../apps/pulsar-worker');
const REFRESH_URL = 'https://pulsar.ruimte.app/internal/benchmarks/refresh';
const TOKEN_LIFETIME_MS = 15 * 60_000;

export async function deployPulsarWorker(
    run: (args: string[]) => Promise<void>,
    request: (url: string, init: RequestInit) => Promise<Response> = fetch
): Promise<void> {
    await run(['d1', 'migrations', 'apply', 'ruimte-pulsar', '--remote']);

    const token = randomBytes(32).toString('hex');
    const digest = createHash('sha256').update(token).digest('base64url');
    const expiresAt = Date.now() + TOKEN_LIFETIME_MS;
    // Wrangler prints plain-text bindings, so only the digest and expiry may enter its arguments.
    await run(['deploy', '--var', `BENCHMARK_REFRESH_TOKEN_HASH:${digest}`, '--var', `BENCHMARK_REFRESH_TOKEN_EXPIRES_AT:${expiresAt}`]);

    const response = await request(REFRESH_URL, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        redirect: 'error',
        signal: AbortSignal.timeout(180_000)
    }).catch(() => {
        throw new Error('Worker deployed, but the benchmark refresh request failed. Check the live snapshot before deploying again.');
    });
    if (!response.ok) {
        throw new Error(`Worker deployed, but benchmark refresh failed (HTTP ${response.status}). The previous snapshot was kept.`);
    }
    const result = (await response.json().catch(() => null)) as { refreshed?: boolean; fetchedAt?: number; measurements?: number } | null;
    if (result?.refreshed !== true || !Number.isSafeInteger(result.fetchedAt) || !Number.isSafeInteger(result.measurements) || result.measurements! < 1) {
        throw new Error('Worker deployed, but the benchmark refresh did not confirm a new snapshot.');
    }
    console.log(`Benchmarks refreshed: ${result.measurements} measurements at ${new Date(result.fetchedAt!).toISOString()}`);
}

async function wrangler(args: string[]): Promise<void> {
    const child = Bun.spawn(['bunx', 'wrangler', ...args], { cwd: WORKER_ROOT, stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' });
    const code = await child.exited;
    if (code !== 0) {
        throw new Error(`Wrangler ${args[0]} failed (exit ${code}).`);
    }
}

if (import.meta.main) {
    try {
        await deployPulsarWorker(wrangler);
    } catch (error) {
        console.error(error instanceof Error ? error.message : 'Worker deployment failed.');
        process.exitCode = 1;
    }
}
