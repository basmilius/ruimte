import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const profile = await mkdtemp(join(tmpdir(), 'ruimte-vite-browser-'));
const browser = spawn(
    process.argv[3] ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    [
        '--headless=new',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-networking',
        '--remote-debugging-port=0',
        `--user-data-dir=${profile}`,
        'about:blank'
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] }
);
const closed = new Promise((resolve) => browser.once('close', resolve));
let socket;
let closing = false;
const startup = setTimeout(() => browser.kill(), 25000);
try {
    const address = await new Promise((resolve, reject) => {
        let output = '';
        browser.stderr.on('data', (chunk) => {
            output += chunk;
            const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
            if (match) {
                resolve(match[1]);
            }
        });
        browser.once('error', reject);
        browser.once('exit', (code) => reject(new Error(`Browser exited with ${code}`)));
    });
    clearTimeout(startup);
    socket = new WebSocket(address);
    await new Promise((resolve, reject) => {
        socket.addEventListener('open', resolve, { once: true });
        socket.addEventListener('error', reject, { once: true });
    });
    let sequence = 0;
    const pending = new Map();
    let navigationReady;
    socket.addEventListener('message', (event) => {
        const message = JSON.parse(event.data);
        if (message.id) {
            const request = pending.get(message.id);
            pending.delete(message.id);
            clearTimeout(request.timeout);
            if (message.error) {
                request.reject(new Error(message.error.message));
            } else {
                request.resolve(message.result);
            }
        } else if (message.method === 'Page.domContentEventFired') {
            navigationReady?.();
        }
    });
    function send(method, params = {}, sessionId) {
        return new Promise((resolve, reject) => {
            const id = ++sequence;
            const timeout = setTimeout(() => {
                pending.delete(id);
                reject(new Error(`${method} timed out`));
            }, 20000);
            pending.set(id, { resolve, reject, timeout });
            socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
        });
    }
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send('Runtime.enable', {}, sessionId);
    await send('Page.enable', {}, sessionId);
    const navigation = new Promise((resolve) => {
        navigationReady = resolve;
    });
    await send('Page.navigate', { url: process.argv[2] ?? 'http://localhost:4212' }, sessionId);
    await navigation;
    const boot = await send(
        'Runtime.evaluate',
        {
            expression: `new Promise((resolve, reject) => {
            const ready = () => document.querySelector('#root')?.childElementCount > 0;
            if (ready()) { resolve(document.body.innerText); return; }
            const observer = new MutationObserver(() => {
                if (ready()) { observer.disconnect(); clearTimeout(timer); resolve(document.body.innerText); }
            });
            observer.observe(document, { childList: true, subtree: true });
            const timer = setTimeout(() => { observer.disconnect(); reject(new Error('Client did not render')); }, 15000);
        })`,
            awaitPromise: true,
            returnByValue: true
        },
        sessionId
    );
    const probe = await send(
        'Runtime.evaluate',
        {
            expression: `import('/src/canvas/nodes/NoteNode.tsx').then(() => ({ok: true}), (error) => ({ok: false, message: error.message}))`,
            awaitPromise: true,
            returnByValue: true
        },
        sessionId
    );
    const result = probe.result.value ?? { ok: false, message: probe.exceptionDetails?.text };
    if (process.argv[4] === 'editor-labels') {
        const labels = await send(
            'Runtime.evaluate',
            {
                expression: `import('/testing/editor-label-probe.ts').then((probe) => probe.probeEditorLabels())`,
                awaitPromise: true,
                returnByValue: true
            },
            sessionId
        );
        result.labels = labels.result.value;
        if (labels.exceptionDetails) {
            result.ok = false;
            result.message = labels.exceptionDetails.exception?.description ?? labels.exceptionDetails.text;
        }
    }
    console.log(JSON.stringify({ boot: boot.result?.value, probe: result }, null, 2));
    if (!result.ok) {
        process.exitCode = 1;
    }
    await send('Browser.close');
    closing = true;
} finally {
    clearTimeout(startup);
    socket?.close();
    if (!closing && browser.exitCode === null) {
        browser.kill();
    }
    await closed;
    // Chrome helpers can finish writing the profile after the browser exits.
    await rm(profile, { recursive: true, force: true, maxRetries: 3 });
}
