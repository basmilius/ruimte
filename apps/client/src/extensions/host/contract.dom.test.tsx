import { afterEach } from 'bun:test';
import { createElement, type ComponentType } from 'react';
import type { ExtensionManifest, ProjectView } from '@ruimte/contracts';
import { clientContract, NAME, SEED } from '@extensions/poc-contract/contract/client';
import { runAction } from '@/extensions/action-runs';
import { clientApiFor, type LoadedExtension } from '@/extensions/host/client-api';
import { forgetExtension, registerExtension } from '@/extensions/host/runtime';
import { useContributions } from '@/extensions/registry';
import { baseContext, nodeInfoOf, resolveSlot } from '@/extensions/slots';
import { defaultCanvases, focusedCanvas } from '@/state/canvas';
import type { CanvasNode } from '@/state/canvas-model';
import { useDocument } from '@/state/document';
import { useProject } from '@/state/project';
import { useToasts } from '@/state/toasts';
import { connectFakeMachine, FakeMachine } from '../../../testing/fake-machine';
import { clickOn, mount, until, type Mounted } from '../../../testing/dom';

const ID = 'poc.contract';
const mounts: Mounted[] = [];
let disconnect: (() => void) | null = null;

afterEach(async () => {
    for (const mounted of mounts.splice(0)) {
        await mounted.unmount();
    }

    disconnect?.();
    disconnect = null;
    forgetExtension(ID);
    delete document.documentElement.dataset.theme;
});

function entryOf(action: string) {
    const entry = useContributions.getState().slotEntries.find((each) => each.id === `${ID}/${action}`);

    if (entry === undefined) {
        throw new Error(`No action ${action}`);
    }

    return entry;
}

/* What the client host tells a slot: the base context and each node it was handed, as it is now. */
function contextOf(extra: object): Record<string, unknown> {
    const nodes = (value: unknown): unknown =>
        Array.isArray(value) ? value.map(nodes) : typeof value === 'object' && value !== null && 'id' in value ? nodeInfoOf(String(value.id)) : value;

    return { ...baseContext(), ...Object.fromEntries(Object.entries(extra).map(([key, value]) => [key, nodes(value)])) };
}

/* The real client host of `poc.contract`, on a fake machine that keeps what it is told to store. */
clientContract(async (permissions) => {
    const manifest: ExtensionManifest = { id: ID, name: NAME, version: '0.1.0', api: 1, permissions };
    const extension: LoadedExtension = { manifest, base: '/', disposers: [], settings: null };
    const machine = new FakeMachine();
    const stored = new Map<string, unknown>();
    const before = useToasts.getState().toasts.length;

    machine.answer('extension.storageGet', ({ key }) => ({ value: stored.get(key) }));
    machine.answer('extension.storageSet', ({ key, value }) => {
        stored.set(key, value);

        return {};
    });
    disconnect = connectFakeMachine(machine);
    registerExtension(extension);
    useProject.setState({ current: { ...useProject.getState().current, ...PROJECT } });
    useDocument.setState({ views: [{ id: SEED.view.id, kind: 'canvas', name: SEED.view.name } as ProjectView], activeViewId: SEED.view.id });
    // A canvas on screen, so a node on it is on a canvas of this window.
    defaultCanvases.of(SEED.view.id);
    defaultCanvases.focus(SEED.view.id);
    document.documentElement.dataset.theme = 'dark';
    focusedCanvas().setState({
        viewId: SEED.view.id,
        nodes: { [SEED.node.id]: { id: SEED.node.id, kind: 'note', title: SEED.node.title, x: 0, y: 0, w: 320, h: 200 } as CanvasNode },
        edges: [],
        selection: []
    });

    const api = clientApiFor(extension);

    return {
        api: api as never,
        createElement: createElement as (type: unknown, props?: object | null, ...children: unknown[]) => unknown,
        async render(component) {
            api.defineSidebarCard({ id: `card-${mounts.length}`, title: 'Card', component: async () => ({ default: component as ComponentType }) });

            const card = useContributions.getState().sidebarCards.find((each) => each.id === `${ID}/card-${mounts.length}`);
            const mounted = mount();

            mounts.push(mounted);
            await mounted.render(createElement(card?.component as ComponentType));

            return {
                text: () => mounted.host.textContent ?? '',
                click: async (label) => {
                    await until(() => [...mounted.host.querySelectorAll('button')].some((button) => button.textContent === label));
                    await clickOn([...mounted.host.querySelectorAll('button')].find((button) => button.textContent === label) ?? null);
                },
                until: (check) =>
                    until(() => {
                        try {
                            return check() !== false;
                        } catch {
                            return false;
                        }
                    })
            };
        },
        slot: (action, place, extra) => resolveSlot([entryOf(action)], place, contextOf(extra))[0]?.title ?? null,
        async run(action, place, extra) {
            const entry = entryOf(action);
            const context = contextOf(extra);
            const shown = resolveSlot([entry], place, context)[0];

            if (shown === undefined) {
                return { ok: false, error: { code: 'refused', message: `${entry.title} does not show in ${place} here` } };
            }

            const toasts = useToasts.getState().toasts.length;

            await runAction({ ...entry, title: shown.title }, context, place);

            const failed = useToasts
                .getState()
                .toasts.slice(toasts)
                .find((toast) => toast.kind === 'error');

            return failed === undefined ? { ok: true, value: undefined } : { ok: false, error: { code: 'failed', message: String(failed.description) } };
        },
        select: (ids) => focusedCanvas().getState().select(ids),
        notes: () =>
            Object.values(focusedCanvas().getState().nodes)
                .filter((node) => node.kind === 'note' && node.id !== SEED.node.id)
                .map((node) => ({ title: node.title, text: node.body ?? '' })),
        links: () =>
            focusedCanvas()
                .getState()
                .edges.map((edge) => ({ from: edge.from, to: edge.to })),
        failures: () =>
            useToasts
                .getState()
                .toasts.slice(before)
                .filter((toast) => toast.kind === 'error')
                .map((toast) => ({ text: String(toast.title), detail: String(toast.description) }))
    };
});

const PROJECT = {
    projectId: SEED.project.id,
    name: SEED.project.name,
    color: '#000',
    folder: SEED.project.folder,
    lastOpenedAt: 0,
    closedAt: null,
    available: true,
    icon: { kind: 'initial' as const, value: 'A' },
    nameSource: 'chosen' as const
};
