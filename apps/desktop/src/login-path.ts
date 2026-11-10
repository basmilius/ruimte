import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';

const MARKER = '__RUIMTE_PATH__';
const ANSWER = new RegExp(`${MARKER}(.*?)${MARKER}`, 's');

/*
 * An app opened from the Dock inherits a bare PATH, not the one the person's rc files build, and the
 * daemon finds `claude` and friends through PATH. So the login shell is asked, which a slow profile
 * makes take seconds; null when it does not answer in time.
 */
export function askLoginShellPath(shell: string | undefined, platform: NodeJS.Platform, timeoutMs = 15_000): Promise<string | null> {
    if (platform === 'win32' || !shell) {
        return Promise.resolve(null);
    }
    return new Promise((resolve) => {
        let output = '';
        const child = spawn(shell, ['-ilc', `printf '${MARKER}%s${MARKER}' "$PATH"`], { stdio: ['ignore', 'pipe', 'ignore'] });
        // An interactive shell ignores SIGTERM, and an agent the profile starts in the background keeps the pipe
        // open after the shell is gone, so the answer is taken as soon as it is complete rather than at close.
        const settle = (path: string | null): void => {
            clearTimeout(timer);
            child.stdout.destroy();
            child.kill('SIGKILL');
            resolve(path);
        };
        const timer = setTimeout(() => settle(null), timeoutMs);
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => {
            output += chunk;
            const answer = ANSWER.exec(output);
            if (answer) {
                settle(answer[1] || null);
            }
        });
        child.on('error', () => settle(null));
        child.on('close', () => settle(ANSWER.exec(output)?.[1] || null));
    });
}

export interface LoginPathCache {
    read(): Promise<string | null>;
    write(path: string): Promise<void>;
}

export function fileLoginPathCache(file: string): LoginPathCache {
    return {
        async read() {
            try {
                const stored = JSON.parse(await readFile(file, 'utf8')) as { path?: unknown };
                return typeof stored.path === 'string' && stored.path !== '' ? stored.path : null;
            } catch {
                return null;
            }
        },
        async write(path) {
            await writeFile(file, `${JSON.stringify({ path })}\n`);
        }
    };
}

interface LoadedLoginPath {
    /* What this start uses: the answer of an earlier start, or the shell's own when there was none. */
    path: string | null;
    /* Settles once the shell answered and a changed answer is in the cache, which the next start uses. */
    refreshed: Promise<void>;
}

/* Only a first start waits on the login shell; every later one takes the last answer and asks again behind it. */
export async function loadLoginPath(cache: LoginPathCache, ask: () => Promise<string | null>): Promise<LoadedLoginPath> {
    const cached = await cache.read().catch(() => null);
    const asked = ask().catch(() => null);
    const refreshed = asked.then(async (path) => {
        if (path !== null && path !== cached) {
            await cache.write(path).catch(() => undefined);
        }
    });
    if (cached !== null) {
        return { path: cached, refreshed };
    }
    await refreshed;
    return { path: await asked, refreshed };
}
