import { afterEach, describe, expect, jest, test } from 'bun:test';
import * as client from '@ruimte/extension/client';
import { createTestHost, createTestServer, type TestNode } from '@ruimte/extension/testing';
import * as ui from '@ruimte/extension/ui';
import { createElement, use, useState } from 'react';
import type { ContractServer } from '../server';
import { clientContract, NAME, SEED, type WorldSeed } from '../contract/client';

/* The pieces of the seed, then what the run does after them. */
async function* streamOf(pieces: string[], end: WorldSeed['streamEnd'], signal: AbortSignal): AsyncGenerator<string> {
    yield* pieces;

    if (end === 'waits') {
        await new Promise((resolve) => signal.addEventListener('abort', resolve));
    } else if (end !== undefined) {
        throw new Error(end.fails);
    }
}

clientContract(async (permissions, seed = {}) => {
    const nodes: TestNode[] = (seed.nodes ?? []).map((node) =>
        node.kind === 'extension'
            ? { id: node.id, extension: { type: node.type, data: node.data, ...(node.dataVersion === undefined ? {} : { dataVersion: node.dataVersion }) } }
            : { id: node.id, kind: node.kind, title: node.title, text: node.text, ...(node.view === undefined ? {} : { view: node.view }) }
    );
    const views = [
        SEED.view,
        ...(seed.views ?? []),
        ...(seed.nodes ?? []).flatMap((node) => ('view' in node && node.view !== undefined ? [{ id: node.view, kind: 'canvas', name: node.view }] : []))
    ];
    let stopped = false;
    const host = await createTestHost({
        manifest: { name: NAME, permissions },
        project: { ...SEED.project, views, nodes: [SEED.node, ...nodes] },
        machine: SEED.machine,
        answers: {
            ...(seed.server === undefined ? {} : { server: seed.server }),
            ...(seed.stream === undefined
                ? {}
                : {
                      'agents.stream': ({ signal }) => {
                          signal.addEventListener('abort', () => {
                              stopped = true;
                          });

                          return streamOf(seed.stream ?? [], seed.streamEnd, signal);
                      }
                  })
        }
    });

    return {
        api: client,
        ui,
        createElement: createElement as (type: unknown, props?: object | null, ...children: unknown[]) => unknown,
        render: (component) => host.render(component as () => null),
        renderNode: (type, nodeId) => host.render(host.node(type), { node: nodeId }),
        reconnect: async () => host.reconnect(),
        fromOtherWindow: async (write) => {
            if ('storage' in write) {
                host.setStorage('computer', write.storage, write.value);
            } else {
                host.setSetting(write.setting, write.value);
            }
        },
        fromServer: async (write) => host.setStorage('machine', write.storage, write.value),
        fileChanged: async (path) => host.changeFile(path),
        streamStopped: () => stopped,
        nodes: () => host.canvas.nodes().map((node) => node.id),
        started: () => {
            const views = host.views();

            return host.agents.calls
                .flatMap((call) => (call.method === 'agents.start' && call.result.ok ? [(call.result.value as { id: string }).id] : []))
                .map((id) => (views.some((view) => view.id === id) ? 'view' : 'canvas'));
        },
        slot: (action, place, extra) => host.slot(host.action(action), place, extra)?.title ?? null,
        run: (action, place, extra) => host.run(host.action(action), place, extra),
        select: (ids) => host.select(ids),
        notes: () => host.canvas.notes().map(({ title, text }) => ({ title, text })),
        links: () => host.canvas.links(),
        failures: () => host.notifications.flatMap(({ text, detail }) => (detail === undefined ? [] : [{ text, detail }]))
    };
});

describe('a test host', () => {
    afterEach(() => {
        jest.useRealTimers();
    });

    test('draws, presses and waits under fake timers, which only the test moves on', async () => {
        jest.useFakeTimers();

        const host = await createTestHost();
        const Later = () => {
            const [done, setDone] = useState(false);

            return createElement('button', { type: 'button', onClick: () => void setTimeout(() => setDone(true), 1000) }, done ? 'Done' : 'Start');
        };
        const screen = await host.render(Later);

        await screen.click('Start');

        expect(screen.text()).toBe('Start');

        jest.advanceTimersByTime(1000);
        await screen.until(() => screen.text() === 'Done');
    });

    test('rejects a click that leaves the surface waiting on what it suspends on', async () => {
        const host = await createTestHost();
        const never = new Promise<string>(() => undefined);
        const Waits = () => createElement('p', null, use(never));
        const Start = () => {
            const [started, setStarted] = useState(false);

            return started ? createElement(Waits) : createElement('button', { type: 'button', onClick: () => setStarted(true) }, 'Start');
        };
        const screen = await host.render(Start);

        await expect(screen.click('Start')).rejects.toThrow('It is still waiting for what it suspends on');
    });

    test("shares the machine's storage with a test server it is handed, both ways", async () => {
        const server = await createTestServer<ContractServer>();
        const host = await createTestHost({ answers: { server } });
        const Count = () => {
            const [count, setCount] = client.useStorage('count', 0, 'machine');

            return createElement('button', { type: 'button', onClick: () => setCount(count + 1) }, `count ${count}`);
        };
        const screen = await host.render(Count);

        await screen.click('count 0');

        expect(await server.call('kept', 'count')).toEqual({ ok: true, value: 1 });

        await server.call('keep', 'count', 5);
        await screen.until(() => screen.text() === 'count 5');
    });
});
