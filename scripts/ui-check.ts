import { mkdir, readFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

/*
 * Readies a check of UI work in Ruimte Dev: says whether ADE CORE is linked, checks that the dev machine of this
 * checkout answers, and opens a throwaway project there for the agent to work in. It starts nothing itself;
 * the `ui-check` skill restarts the dev launch first, so the window runs the code just written.
 * Usage: bun run ui-check
 */

const DEV_PORT = 4211;
const REQUEST_TIMEOUT_MS = 10_000;

const home = process.env.RUIMTE_DEV_HOME ?? join(homedir(), '.ruimte-dev');

interface Reply {
    id: string;
    ok: boolean;
    result?: { summary?: { projectId?: string; name?: string } };
    error?: { code: string; message: string };
}

function stamp(): string {
    return new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');
}

async function adecoreLine(): Promise<string> {
    const child = Bun.spawn(['bun', 'scripts/adecore.ts', 'status', '--brief'], { stdout: 'pipe', stderr: 'ignore' });
    const text = (await new Response(child.stdout).text()).trim();

    return text === '' ? 'ADE CORE: unknown' : text;
}

/* One request over the dev machine's socket, authenticated as a process of this Mac with its local secret. */
function request(secret: string, type: string, payload: unknown): Promise<Reply> {
    return new Promise((resolve, reject) => {
        // Bun's WebSocket takes headers, the DOM's type does not.
        const options = { headers: { authorization: `Bearer ${secret}` } };
        const socket = new WebSocket(`ws://127.0.0.1:${DEV_PORT}/ws`, options as unknown as string[]);
        const timer = setTimeout(() => {
            socket.close();
            reject(new Error(`the dev machine did not answer ${type} within ${REQUEST_TIMEOUT_MS / 1000} s`));
        }, REQUEST_TIMEOUT_MS);

        socket.onopen = () => socket.send(JSON.stringify({ id: '1', type, payload }));
        socket.onerror = () => {
            clearTimeout(timer);
            reject(new Error(`no dev machine on port ${DEV_PORT}; restart the dev launch first`));
        };
        socket.onmessage = (message) => {
            const frame = JSON.parse(String(message.data)) as Reply;

            if (frame.id !== '1') {
                return;
            }

            clearTimeout(timer);
            socket.close();
            resolve(frame);
        };
    });
}

const secret = (await readFile(join(home, 'local.key'), 'utf8').catch(() => '')).trim();

if (secret === '') {
    console.error(`No local secret in ${home}; the dev machine has not run yet. Restart the dev launch first.`);
    process.exit(1);
}

const name = stamp();
const folder = join(tmpdir(), 'ruimte-ui-check', name);

await mkdir(folder, { recursive: true });

const opened = await request(secret, 'project.open', { folder, name: `UI check ${name}` }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});

if (!opened.ok) {
    console.error(`The dev machine refused the project: ${opened.error?.code} ${opened.error?.message}`);
    process.exit(1);
}

console.log(await adecoreLine());
console.log(`project\t${opened.result?.summary?.name ?? '-'}\t${opened.result?.summary?.projectId ?? '-'}\t${folder}`);
console.log('app\tRuimte Dev (app.ruimte.desktop.dev); open this project from its project menu, and operate nothing else');
