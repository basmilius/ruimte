import { afterEach } from 'bun:test';
import { act, createElement, type ComponentType, type ReactElement } from 'react';
import * as ui from '@adecore/ui';
import type { ExtensionManifest, ProjectView } from '@ruimte/contracts';
import { contextSelection } from '@ruimte/contracts/extension-context';
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
import { TransportError } from '@/transport';
import { clientContract, NAME, SEED, type ContractScreen, type SeedNode } from '../../../../../extensions/poc-contract/contract/client';
import { connectFakeMachine, FakeMachine } from '../../../testing/fake-machine';
import { emptyCanvas } from '../../../testing/project-fixtures';
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

    for (const key of Object.keys(localStorage).filter((each) => each.startsWith(`ruimte.extension.${ID}.`))) {
        localStorage.removeItem(key);
    }
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

/* What a person reads and presses of something drawn. */
function screenOf(mounted: Mounted): ContractScreen {
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
}

function canvasNodeOf(node: SeedNode): CanvasNode {
    const frame = { id: node.id, x: 0, y: 400, w: 320, h: 200 };

    if (node.kind === 'extension') {
        const raw = {
            kind: 'extension',
            ...frame,
            extension: ID,
            type: node.type,
            data: node.data,
            ...(node.dataVersion === undefined ? {} : { dataVersion: node.dataVersion })
        };

        return { ...frame, kind: 'unknown', title: node.type, raw } as CanvasNode;
    }

    return { ...frame, kind: node.kind, title: node.title } as CanvasNode;
}

/* The real client host of `poc.contract`, on a fake machine that keeps what it is told to store and answers by its own rules. */
clientContract(async (permissions, seed = {}) => {
    const manifest: ExtensionManifest = { id: ID, name: NAME, version: '0.1.0', api: 1, permissions };
    const extension: LoadedExtension = { manifest, base: '/', disposers: [], settings: null };
    const machine = new FakeMachine();
    const stored = new Map<string, unknown>();
    const before = useToasts.getState().toasts.length;
    const nodes = [{ ...SEED.node, text: '' }, ...(seed.nodes ?? []).flatMap((node) => (node.kind === 'extension' ? [] : [node]))];

    machine.answer('extension.storageGet', ({ key }) => ({ value: stored.get(key) }));
    machine.answer('extension.storageSet', ({ key, value }) => {
        stored.set(key, value);

        return {};
    });
    // The machine's own rule over the nodes of the seed: it skips another kind before it reads.
    machine.answer('extension.contextRead', (of) => ({
        sources: nodes
            .filter((node) => contextSelection(of)(node.id, SEED.view.id) && (of.kind === undefined || node.kind === of.kind))
            .map((node) => ({ id: node.id, kind: node.kind, title: node.title, text: node.text }))
    }));
    machine.answer('extension.chatRead', ({ chatId }) => {
        const chat = nodes.find((node) => node.id === chatId && node.kind === 'chat');

        if (chat === undefined) {
            throw new TransportError('not-found', `No chat ${chatId} on this machine`);
        }

        return { text: chat.text };
    });
    // A canvas node where the client names the canvas, a chat view of its own where it names none.
    machine.answer('extension.agentStart', ({ viewId }) => ({ nodeId: viewId === undefined ? 'chat-view' : 'chat-node' }));
    machine.answer('extension.call', async ({ method, args }) => {
        const run = seed.server?.[method];

        if (run === undefined) {
            throw new TransportError('not-found', `No method ${method}`);
        }

        return { result: await (run as (...values: unknown[]) => unknown)(...args) };
    });
    machine.answer('extension.agentStream', ({ runId }) => {
        for (const text of seed.stream ?? []) {
            machine.emit('extension.agentChunk', { runId, text });
        }

        return {};
    });
    disconnect = connectFakeMachine(machine);
    registerExtension(extension);
    useProject.setState({ current: { ...useProject.getState().current, ...PROJECT } });
    // A canvas on screen, so a node on it is on a canvas of this window. The client's events follow the canvas in front
    // once the view in front changes, which an earlier test file may have left on this one.
    defaultCanvases.of(SEED.view.id);
    defaultCanvases.focus(SEED.view.id);
    useDocument.setState({
        views: [emptyCanvas(SEED.view.id, SEED.view.name), ...(seed.views ?? []).map((view) => ({ ...view, url: '' }) as ProjectView)],
        activeViewId: null
    });
    useDocument.setState({ activeViewId: SEED.view.id });
    document.documentElement.dataset.theme = 'dark';
    focusedCanvas().setState({
        viewId: SEED.view.id,
        nodes: Object.fromEntries(
            [{ id: SEED.node.id, kind: 'note', title: SEED.node.title, x: 0, y: 0, w: 320, h: 200 } as CanvasNode, ...(seed.nodes ?? []).map(canvasNodeOf)].map(
                (node) => [node.id, node]
            )
        ),
        edges: [],
        selection: []
    });

    const api = clientApiFor(extension);
    const draw = async (element: ReactElement): Promise<ContractScreen> => {
        const mounted = mount();

        mounts.push(mounted);
        await mounted.render(element);

        return screenOf(mounted);
    };

    return {
        api: api as never,
        ui,
        createElement: createElement as (type: unknown, props?: object | null, ...children: unknown[]) => unknown,
        async render(component) {
            api.defineSidebarCard({ id: `card-${mounts.length}`, title: 'Card', component: async () => ({ default: component as ComponentType }) });

            const card = useContributions.getState().sidebarCards.find((each) => each.id === `${ID}/card-${mounts.length}`);

            return draw(createElement(card?.component as ComponentType));
        },
        renderNode(type, nodeId) {
            const node = useContributions.getState().extensionNodes.find((each) => each.id === `${ID}/${type}`);

            return draw(createElement(node?.component as ComponentType<{ nodeId: string }>, { nodeId }));
        },
        async reconnect() {
            await act(async () => {
                machine.drop();
                machine.reopen();
            });
        },
        async fromOtherWindow(write) {
            const key = 'storage' in write ? `ruimte.extension.${ID}.${write.storage}` : `ruimte.extension.${ID}.setting.${write.setting}`;

            // Another window writes the key, and only the other windows hear `storage`.
            await act(async () => {
                localStorage.setItem(key, JSON.stringify(write.value));
                window.dispatchEvent(new StorageEvent('storage', { key }));
            });
        },
        started: () => machine.requests('extension.agentStart').map(({ viewId }) => (viewId === undefined ? 'view' : 'canvas')),
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
