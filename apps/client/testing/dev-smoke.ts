import { expect } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, type InlineConfig, type ViteDevServer } from 'vite';

const MAC_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export const smokeBrowser = existsSync(MAC_CHROME) ? MAC_CHROME : (Bun.which('google-chrome') ?? Bun.which('chromium') ?? Bun.which('chromium-browser'));
export const smokeNode = Bun.which('node');

type Probe = 'editor-labels' | 'image-save';

export interface DevServer {
    readonly server: ViteDevServer;
    readonly url: string;
    close(): Promise<void>;
}

/* The client's own dev server on a free port with a cache of its own, until it is closed. */
export async function openDevServer(config: InlineConfig): Promise<DevServer> {
    const temporary = await mkdtemp(join(tmpdir(), 'ruimte-dev-smoke-'));
    const server = await createServer({
        root: fileURLToPath(new URL('..', import.meta.url)),
        configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
        cacheDir: join(temporary, 'cache'),
        logLevel: 'silent',
        // Bundled dev serves only what the app's entries reach, and a probe module is imported on its own.
        experimental: { bundledDev: false },
        ...config,
        server: { port: 0, warmup: { clientFiles: [] } }
    });
    const close = async (): Promise<void> => {
        await server.close();
        await rm(temporary, { recursive: true, force: true });
    };

    try {
        await server.listen();
        const address = server.httpServer?.address();

        if (address === null || address === undefined || typeof address === 'string') {
            throw new Error('Vite did not bind a TCP port');
        }

        return { server, url: `http://localhost:${address.port}`, close };
    } catch (error) {
        await close();
        throw error;
    }
}

function spawnSmoke(url: string, probe: Probe, output: 'pipe' | 'ignore') {
    return Bun.spawn([smokeNode!, fileURLToPath(new URL('./dev-import-smoke.mjs', import.meta.url)), url, smokeBrowser!, probe], {
        stdout: output,
        stderr: output
    });
}

/*
 * Runs a probe once and drops what it found, so the dependency optimization and the transform of every
 * module it loads happen before a test and outside its timeout. A failure here shows in the test.
 */
export async function warmSmoke(url: string, probe: Probe): Promise<void> {
    await spawnSmoke(url, probe, 'ignore').exited;
}

/* Runs one probe of `dev-import-smoke.mjs` in a headless browser against the dev server, and answers what it found. */
export async function runSmoke(url: string, probe: Probe): Promise<Record<string, unknown>> {
    const process = spawnSmoke(url, probe, 'pipe');
    const [output, errors, exitCode] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited]);
    expect(exitCode, `${output}\n${errors}`).toBe(0);
    return JSON.parse(output).probe;
}
