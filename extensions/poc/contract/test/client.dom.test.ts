import { afterEach, describe, expect, jest, test } from 'bun:test';
import * as client from '@ruimte/extension/client';
import { createTestHost, createTestServer, type TestNode } from '@ruimte/extension/testing';
import * as ui from '@ruimte/extension/ui';
import { createElement, useState } from 'react';
import { clientContract, NAME, SEED, type SeedAgent, type WorldSeed } from '../contract/client';
import type { ContractServer } from '../server';

async function* streamOf(pieces: string[], end: WorldSeed['streamEnd'], signal: AbortSignal): AsyncGenerator<string> {
    yield* pieces;

    if (end === 'waits') {
        await new Promise((resolve) => signal.addEventListener('abort', resolve));
    } else if (end !== undefined) {
        throw new Error(end.fails);
    }
}

/* What the machine reports of a seeded agent, as the test host takes it. */
function agentOf(agent: SeedAgent): Pick<TestNode, 'agent' | 'subagents'> {
    const waits = agent.doing !== 'turn';

    return {
        agent: { provider: agent.provider, status: waits ? 'needsYou' : 'running', activity: waits ? null : 'turn', snoozed: agent.doing === 'snoozed' },
        ...(agent.subagents === undefined ? {} : { subagents: agent.subagents.map((kid) => (kid.node === undefined ? {} : { node: kid.node })) })
    };
}

clientContract(async (permissions, seed = {}) => {
    const nodes: TestNode[] = (seed.nodes ?? []).map((node) =>
        node.kind === 'extension'
            ? { id: node.id, extension: { type: node.type, data: node.data, ...(node.dataVersion === undefined ? {} : { dataVersion: node.dataVersion }) } }
            : {
                  id: node.id,
                  kind: node.kind,
                  title: node.title,
                  text: node.text,
                  ...(node.view === undefined ? {} : { view: node.view }),
                  ...(node.agent === undefined ? {} : agentOf(node.agent))
              }
    );
    const views = [
        SEED.view,
        ...(seed.views ?? []),
        ...(seed.nodes ?? []).flatMap((node) => ('view' in node && node.view !== undefined ? [{ id: node.view, kind: 'canvas', name: node.view }] : []))
    ];
    let stopped = false;
    const asked = Promise.withResolvers<void>();
    const start = Promise.withResolvers<void>();
    const host = await createTestHost({
        manifest: { name: NAME, permissions },
        project: { ...SEED.project, views, nodes: [SEED.node, ...nodes] },
        machine: SEED.machine,
        ...(seed.providers === undefined ? {} : { providers: seed.providers }),
        answers: {
            ...(seed.server === undefined ? {} : { server: seed.server }),
            ...(seed.stream === undefined
                ? {}
                : {
                      'agents.stream': ({ signal }) => {
                          signal.addEventListener('abort', () => {
                              stopped = true;
                          });
                          asked.resolve();

                          // Its pieces once it may start, whether or not it was stopped meanwhile.
                          if (seed.streamStart === 'held') {
                              return start.promise.then(() => seed.stream ?? []);
                          }

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
        streamAsked: () => asked.promise,
        letStreamStart: () => start.resolve(),
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

    test('fails at once on an option or answer it would never read, and names where an answer goes', async () => {
        const server = { greeting: () => 'Hello' };

        await expect(createTestHost({ server } as never)).rejects.toThrow('createTestHost takes server under answers, not beside it');
        await expect(createTestHost({ selected: ['a'] } as never)).rejects.toThrow('createTestHost has no option selected');
        await expect(createTestHost({ answers: { 'launches.start': () => null } } as never)).rejects.toThrow(
            'createTestHost answers nothing under launches.start'
        );
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
