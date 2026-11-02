import * as client from '@ruimte/extension/client';
import { createTestHost } from '@ruimte/extension/testing';
import { createElement } from 'react';
import { clientContract, NAME, SEED } from '../contract/client';

clientContract(async (permissions) => {
    const host = await createTestHost({
        manifest: { name: NAME, permissions },
        project: { ...SEED.project, views: [SEED.view], nodes: [SEED.node] },
        machine: SEED.machine
    });

    return {
        api: client,
        createElement: createElement as (type: unknown, props?: object | null, ...children: unknown[]) => unknown,
        render: (component) => host.render(component as () => null),
        slot: (action, place, extra) => host.slot(host.action(action), place, extra)?.title ?? null,
        run: (action, place, extra) => host.run(host.action(action), place, extra),
        select: (ids) => host.select(ids),
        notes: () => host.canvas.notes().map(({ title, text }) => ({ title, text })),
        links: () => host.canvas.links(),
        failures: () => host.notifications.flatMap(({ text, detail }) => (detail === undefined ? [] : [{ text, detail }]))
    };
});
