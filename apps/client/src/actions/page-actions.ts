import { ActionRefusal, type ActionHandlers, type ActionOutput } from '@ruimte/actions';
import { agentAddressProblem, normalizeUrl } from '@ruimte/contracts';
import type { StoreApi } from 'zustand';
import { refuseUnreachableBrowser } from '@/actions/action-reach';
import { pageStateOf } from '@/browser/page-hold';
import { browserRegistry, useBrowser, type BrowserState } from '@/clients/browser/registry';
import { isDesktop } from '@/desktop/bridge';
import { currentEndpointId } from '@/state/current-endpoint';
import type { DocumentState } from '@/state/document';
import { endpointKey } from '@/state/keys';
import { nodesOfView } from '@/state/view-nodes';
import { readNodeHost, updateHost } from '@/surface/nodes/node-host';
import { browserClientFor } from '@/workspace/connections';

/* Only what a page's address and its own history do; a click, a keystroke and a scroll are never one of these. */
export type PageDrive = { kind: 'go'; url: string } | { kind: 'back' } | { kind: 'forward' } | { kind: 'reload'; hard: boolean } | { kind: 'stop' };

/* What the page actions reach outside the document; a test hands in a fake of each. */
export interface PageMachine {
    /* Whether this window draws the page of that node, which is the only page it can drive. */
    holds(nodeId: string): boolean;
    page(nodeId: string): BrowserState | null;
    /* Gives a node that has no page yet its address, which is what starts one. */
    assign(nodeId: string, url: string): void;
    drive(nodeId: string, drive: PageDrive): void;
}

function keyOf(nodeId: string): string {
    return endpointKey(currentEndpointId(), nodeId);
}

const LIVE_MACHINE: PageMachine = {
    holds: (nodeId) => (isDesktop() ? browserRegistry.has(keyOf(nodeId)) : browserClientFor(currentEndpointId()) !== null),
    page: (nodeId) => useBrowser.getState().byKey[keyOf(nodeId)] ?? null,
    assign: (nodeId, url) => {
        if (readNodeHost(nodeId) === null) {
            throw new ActionRefusal('inactive-canvas', 'Open the canvas this browser node is on before giving it an address.');
        }
        updateHost(nodeId, { url });
    },
    drive: (nodeId, drive) => {
        const key = keyOf(nodeId);
        if (!isDesktop()) {
            const client = browserClientFor(currentEndpointId());
            if (drive.kind === 'go') {
                client?.navigate(nodeId, drive.url);
            } else {
                client?.command(nodeId, drive.kind, drive.kind === 'reload' ? drive.hard : undefined);
            }
            return;
        }
        switch (drive.kind) {
            case 'go':
                browserRegistry.navigate(key, drive.url);
                return;
            case 'back':
                browserRegistry.back(key);
                return;
            case 'forward':
                browserRegistry.forward(key);
                return;
            case 'reload':
                browserRegistry.reload(key, drive.hard);
                return;
            case 'stop':
                browserRegistry.stop(key);
        }
    }
};

/*
 * What a person does to the page of a browser node or view, as actions: the address bar, the splash,
 * the page's buttons and its context menu. The page lives in this window, so the answer is where it
 * stands the moment the ask went out; a load that follows shows in the node, not here.
 */
export function pageActions(document: StoreApi<DocumentState>, overrides: Partial<PageMachine> = {}): ActionHandlers<void> {
    const machine: PageMachine = { ...LIVE_MACHINE, ...overrides };

    const browserOf = (nodeId: string): { title: string; url: string; browserOwner?: string } => {
        for (const view of document.getState().views) {
            if (view.kind === 'browser' && view.id === nodeId) {
                return { title: view.name ?? nodeId, url: view.url ?? '', browserOwner: view.browserOwner };
            }
            const node = nodesOfView(view).find((candidate) => candidate.id === nodeId);
            if (node?.kind === 'browser') {
                return { title: node.title, url: node.url ?? '', browserOwner: node.browserOwner };
            }
        }
        throw new ActionRefusal('not-a-browser', `No browser node or view with id “${nodeId}” exists in this project.`);
    };

    const outcome = (nodeId: string): ActionOutput<'browser.inspect'> => {
        if (!machine.holds(nodeId)) {
            return { nodeId, open: false, page: null, error: null };
        }
        const row = machine.page(nodeId);
        if (row === null) {
            return { nodeId, open: true, page: null, error: null };
        }
        const state = pageStateOf(nodeId, row);
        return {
            nodeId,
            open: true,
            page: { url: state.url, title: state.title, loading: state.loading, canGoBack: state.canGoBack, canGoForward: state.canGoForward },
            error: state.error ?? null
        };
    };

    /* Nobody here holding the page is an answer, never an error, the way the daemon says it to an agent. */
    const driven = (nodeId: string, drive: PageDrive) => {
        const browser = browserOf(nodeId);
        if (drive.kind !== 'stop') {
            refuseUnreachableBrowser('browser', drive.kind === 'go' ? drive.url : browser.url, browser.browserOwner);
        }
        if (machine.holds(nodeId)) {
            machine.drive(nodeId, drive);
        }
        return { output: outcome(nodeId) };
    };

    return {
        'browser.inspect': ({ nodeId }) => {
            browserOf(nodeId);
            return { output: outcome(nodeId) };
        },
        'browser.navigate': ({ nodeId, url }, { actor }) => {
            const { title, url: saved, browserOwner } = browserOf(nodeId);
            const address = normalizeUrl(url);
            refuseUnreachableBrowser('browser', address, browserOwner);
            if (actor.kind !== 'person' && agentAddressProblem(address) !== null) {
                throw new ActionRefusal('bad-url', `“${url}” is not an http or https address.`);
            }
            if (saved === '') {
                machine.assign(nodeId, address);
                return { output: { nodeId, open: false, page: null, error: null, assigned: { url: address, title } } };
            }
            return { output: { ...driven(nodeId, { kind: 'go', url: address }).output, assigned: null } };
        },
        'browser.back': ({ nodeId }) => driven(nodeId, { kind: 'back' }),
        'browser.forward': ({ nodeId }) => driven(nodeId, { kind: 'forward' }),
        'browser.reload': ({ nodeId, hard }) => driven(nodeId, { kind: 'reload', hard }),
        'browser.stop': ({ nodeId }) => driven(nodeId, { kind: 'stop' })
    };
}
