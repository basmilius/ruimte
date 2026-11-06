import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuthTicketResultSchema, MACHINE_HEALTH_PATH } from '@ruimte/contracts';
import { localKeyPath } from '@ruimte/service/home';
import { proveDaemon } from '../../../desktop/src/daemon-proof';
import { LinkTransport } from '../../src/transport/link-transport';
import { socketLink } from '../../src/transport/websocket-transport';
import { median, reservedPort, spawnBenchDaemon, stopBenchDaemon } from './bench';
import { measureRestore } from './restore';

const runs = Number(process.env.BENCH_RUNS ?? 5);
const pollMs = Number(process.env.BENCH_POLL_MS ?? 10);
const projects = Number(process.env.BENCH_PROJECTS ?? 0);
if (!Number.isInteger(projects) || projects < 0 || (projects > 0 && process.env.BENCH_RESTORE === '1')) {
    throw new Error('BENCH_PROJECTS must be a nonnegative integer and cannot be combined with BENCH_RESTORE');
}
const root = await mkdtemp(join(tmpdir(), 'ruimte-daemon-bench-'));
const samples = [];
try {
    for (let run = projects > 0 ? -1 : 0; run < runs; run++) {
        const home = process.env.BENCH_RESTORE === '1' ? join(root, `home-${run}`) : root;
        const port = await reservedPort();
        const started = performance.now();
        const child = spawnBenchDaemon(home, port, process.env.BENCH_DAEMON_BINARY);
        const stdout = new Response(child.stdout).text();
        const stderr = new Response(child.stderr).text();
        let transport: LinkTransport | null = null;
        let connectedTimer: ReturnType<typeof setTimeout> | undefined;
        try {
            const base = `http://127.0.0.1:${port}`;
            let listening = false;
            while (performance.now() - started < 30_000 && child.exitCode === null) {
                const response = await fetch(`${base}${MACHINE_HEALTH_PATH}`, { signal: AbortSignal.timeout(200) }).catch(() => null);
                if (response?.ok) {
                    listening = true;
                    break;
                }
                await Bun.sleep(pollMs);
            }
            if (!listening) {
                throw new Error(`Daemon did not listen; exit code ${child.exitCode}`);
            }
            const listeningMs = performance.now() - started;
            const secret = (await readFile(localKeyPath(home), 'utf8')).trim();
            if (!(await proveDaemon({ port, readSecret: async () => secret, nonce: () => randomBytes(16).toString('hex'), fetch }))) {
                throw new Error('Local daemon did not prove its identity');
            }
            const provenMs = performance.now() - started;
            const ticketResponse = await fetch(`${base}/auth/local-ticket`, { method: 'POST', headers: { authorization: `Bearer ${secret}` } });
            const { ticket } = AuthTicketResultSchema.parse(await ticketResponse.json());
            const ticketMs = performance.now() - started;
            transport = new LinkTransport(`ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(ticket)}`, socketLink, {
                log: { info: () => undefined, warn: () => undefined }
            });
            await new Promise<void>((resolve, reject) => {
                connectedTimer = setTimeout(() => reject(new Error('Local protocol handshake timed out')), 10_000);
                const ready = (): void => {
                    if (transport!.status === 'open') {
                        clearTimeout(connectedTimer);
                        resolve();
                    }
                };
                transport!.subscribeStatus(ready);
                ready();
            });
            const connectedMs = performance.now() - started;
            const result = await transport.request('project.list', {});
            if (result.projects.length !== (run < 0 ? 0 : projects)) {
                throw new Error('Benchmark home contains an unexpected number of projects');
            }
            if (run < 0) {
                for (let project = 0; project < projects; project++) {
                    await transport.request('project.open', { folder: join(home, 'scratch', `benchmark-${project}`), createFolder: true });
                }
                continue;
            }
            samples.push({ listeningMs, provenMs, ticketMs, connectedMs, projectsMs: performance.now() - started });
            if (process.env.BENCH_RESTORE === '1') {
                const opened = await transport.request('project.open', { folder: join(home, 'scratch/benchmark-project'), createFolder: true });
                const restore = await measureRestore({ daemonUrl: base, secret, projectId: opened.summary.projectId, profile: join(root, `browser-${run}`) });
                Object.assign(samples[run]!, { restore });
            }
        } finally {
            clearTimeout(connectedTimer);
            transport?.dispose();
            await stopBenchDaemon(child);
            const output = await stdout;
            await stderr;
            const phases = output.split('\n').flatMap((line) => {
                const marker = line.indexOf('[PERF_PHASE]');
                return marker < 0 ? [] : [JSON.parse(line.slice(marker + '[PERF_PHASE]'.length))];
            });
            if (phases.length > 0 && samples[run]) {
                Object.assign(samples[run]!, { phases });
            }
        }
    }
    console.log(
        JSON.stringify(
            {
                benchmark: 'daemon-local-startup',
                runs,
                pollMs,
                mode: process.env.BENCH_DAEMON_BINARY ? 'compiled' : 'source',
                projects,
                instrumented: Boolean(process.env.BENCH_DAEMON_PRELOAD),
                samples
            },
            null,
            2
        )
    );
    if (median(samples.map((sample) => sample.projectsMs)) > Number(process.env.BENCH_MAX_STARTUP_MS ?? Infinity)) {
        throw new Error('Local daemon startup exceeded its timing budget');
    }
} finally {
    await rm(root, { recursive: true, force: true });
}
