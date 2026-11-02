import { afterEach, describe, expect, jest, test } from 'bun:test';
import * as client from '@ruimte/extension/client';
import { createTestHost, type TestNode } from '@ruimte/extension/testing';
import * as ui from '@ruimte/extension/ui';
import { createElement, useState } from 'react';
import { clientContract, NAME, SEED } from '../contract/client';

clientContract(async (permissions, seed = {}) => {
    const nodes: TestNode[] = (seed.nodes ?? []).map((node) =>
        node.kind === 'extension'
            ? { id: node.id, extension: { type: node.type, data: node.data, ...(node.dataVersion === undefined ? {} : { dataVersion: node.dataVersion }) } }
            : { id: node.id, kind: node.kind, title: node.title, text: node.text }
    );
    const host = await createTestHost({
        manifest: { name: NAME, permissions },
        project: { ...SEED.project, views: [SEED.view, ...(seed.views ?? [])], nodes: [SEED.node, ...nodes] },
        machine: SEED.machine,
        answers: {
            ...(seed.server === undefined ? {} : { server: seed.server }),
            ...(seed.stream === undefined ? {} : { 'agents.stream': () => seed.stream ?? [] })
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
});
