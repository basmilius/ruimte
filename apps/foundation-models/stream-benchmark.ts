import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BackendEvent } from '../server/src/chat/backend.ts';
import { AppleBackend } from '../server/src/chat/apple-backend.ts';
import { spawnChatProcess } from '../server/src/chat/chat-process.ts';

const home = await mkdtemp(join(tmpdir(), 'ruimte-apple-stream-'));
let finish: ((event: BackendEvent) => void) | undefined;
let started = 0;
let text = '';
let first = 0;
let last = 0;
let deltas = 0;
let rawSnapshots = 0;
let maxForwardMs = 0;
let firstChunkLength = 0;
const arrivals = new Map<string, number>();
const backend = new AppleBackend(
    {
        command: [process.argv[2] ?? fileURLToPath(new URL('./dist/ruimte-foundation-models', import.meta.url))],
        cwd: home,
        env: { ...process.env, RUIMTE_HOME: home } as Record<string, string>,
        selection: { model: 'apple-system', options: {} },
        modelName: 'Apple',
        runtimeMode: 'supervised',
        resume: null,
        generation: 1,
        context: [],
        depth: 0,
        spawn: (options) => {
            const child = spawnChatProcess(options);
            let buffer = '';
            const decoder = new TextDecoder();
            return {
                ...child,
                stdout: child.stdout.pipeThrough(
                    new TransformStream({
                        transform(chunk, controller) {
                            buffer += decoder.decode(chunk, { stream: true });
                            let end;
                            while ((end = buffer.indexOf('\n')) >= 0) {
                                const frame = JSON.parse(buffer.slice(0, end));
                                buffer = buffer.slice(end + 1);
                                if (frame.type === 'text.snapshot') {
                                    rawSnapshots++;
                                    arrivals.set(frame.text, performance.now());
                                }
                                if (frame.type === 'session') {
                                    console.log(JSON.stringify({ contextSize: frame.contextSize, baseTokens: frame.baseTokens }));
                                }
                            }
                            controller.enqueue(chunk);
                        }
                    })
                )
            };
        }
    },
    {
        onEvent: (event) => {
            if (event.type === 'text.delta') {
                const now = performance.now();
                text += event.text;
                if (!first) {
                    first = now;
                    firstChunkLength = text.length;
                }
                last = now;
                deltas++;
                const received = arrivals.get(text);
                if (received !== undefined) {
                    maxForwardMs = Math.max(maxForwardMs, now - received);
                }
            }
            if (event.type === 'text.done') {
                text = event.text;
            }
            if (event.type === 'approval.requested') {
                backend.respondApproval(event.requestId, 'deny');
            }
            if (event.type === 'turn.done' || event.type === 'failed') {
                finish?.(event);
            }
        }
    }
);
try {
    await backend.start();
    for (let index = 0; index < 3; index++) {
        started = performance.now();
        first = 0;
        last = 0;
        deltas = 0;
        firstChunkLength = 0;
        text = '';
        rawSnapshots = 0;
        maxForwardMs = 0;
        arrivals.clear();
        const completed = new Promise<BackendEvent>((resolve) => (finish = resolve));
        const timeout = setTimeout(() => {
            backend.interrupt();
            finish?.({ type: 'failed', message: 'Benchmark timed out.' });
        }, 60000);
        backend.sendTurn({
            text: 'Explain how a rainbow forms in about 150 words, in plain English. Do not use tools.',
            preamble: null,
            attachments: [],
            mentions: [],
            skills: []
        });
        const event = await completed;
        clearTimeout(timeout);
        console.log(
            JSON.stringify({
                turn: index + 1,
                firstTextMs: first ? Math.round(first - started) : null,
                totalMs: Math.round(performance.now() - started),
                characters: text.length,
                deltas,
                rawSnapshots,
                streamCharactersPerSecond: last > first ? Math.round((text.length - firstChunkLength) / ((last - first) / 1000)) : null,
                maxForwardMs: Math.round(maxForwardMs * 100) / 100,
                completion: event
            })
        );
        if (event.type !== 'turn.done' || event.state !== 'done' || !text.trim()) {
            throw new Error('Benchmark generation failed');
        }
    }
} finally {
    await backend.dispose();
    await rm(home, { recursive: true, force: true });
}
