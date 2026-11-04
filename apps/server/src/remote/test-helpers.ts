import type { Subprocess } from 'bun';
import { join } from 'node:path';
import type { ProjectContent } from '@ruimte/contracts';
import { freePort } from '../free-port-test-helpers.ts';
import { waitForAsync } from '../sessions/test-helpers.ts';

/** A project whose canvas holds one Claude chat, `chat-lead`, that hands work to another machine. */
export function leadContent(): ProjectContent {
    return {
        name: 'repo',
        color: '#123456',
        views: [
            {
                kind: 'canvas',
                id: 'main',
                name: 'Canvas',
                nodes: [{ id: 'chat-lead', kind: 'chat', title: 'Lead', x: 0, y: 0, w: 560, h: 640, provider: 'claude' }],
                texts: [],
                edges: [],
                layouts: []
            }
        ]
    };
}

/** A real broker in a process of its own, on a free port. */
export async function startBroker(): Promise<{ broker: Subprocess; port: number; url: string }> {
    const port = await freePort();
    const broker = Bun.spawn(['bun', join(import.meta.dir, '..', '..', '..', 'pulsar-broker', 'src', 'main.ts'), '--port', String(port)], {
        stdout: 'ignore',
        stderr: 'inherit'
    });
    await waitForAsync(async () => (await fetch(`http://127.0.0.1:${port}/health`).catch(() => null))?.ok === true, 'the broker to answer', 15_000);
    return { broker, port, url: `ws://127.0.0.1:${port}` };
}
