import i18next from 'i18next';
import { isCanvasView } from '@ruimte/contracts';
import { createNodeAction } from '@/actions/client-actions';
import { chosenLaunch } from '@/launches/model';
import { useLaunches } from '@/launches/state';
import { revealNode } from '@/project/views';
import { useDocument } from '@/state/document';
import { endpointKey } from '@/state/keys';
import { defaultProjectStore } from '@/state/project';
import { useToasts } from '@/state/toasts';
import { useUi } from '@/state/ui';
import { transportFor } from '@/transport';

interface Target {
    endpointId: string;
    projectId: string;
    key: string;
}

/* Launches belong to the project on screen, on the machine it came from. */
const target = (): Target | null => {
    const { current, currentEndpointId } = defaultProjectStore.getState();
    if (current === null || currentEndpointId === null) {
        return null;
    }
    return { endpointId: currentEndpointId, projectId: current.projectId, key: endpointKey(currentEndpointId, current.projectId) };
};

const failed = (title: string, e: unknown): void => {
    useToasts.getState().show({ kind: 'error', title, description: e instanceof Error ? e.message : String(e) });
};

const nameOf = (at: Target, launchId: string): string =>
    useLaunches.getState().documents[at.key]?.launches.find((launch) => launch.id === launchId)?.name ?? launchId;

export interface StartOptions {
    restart?: boolean;
    /* A person said yes to what it runs, in the approval that asked. */
    approve?: boolean;
    /* Stop the launch that holds its port first. */
    replace?: boolean;
}

/* Starts a launch, or starts it again; what it has to ask a person first comes back as the store's `ask`. */
export const startLaunch = async (launchId: string, options: StartOptions = {}): Promise<void> => {
    const at = target();
    const link = at === null ? null : transportFor(at.endpointId);
    if (at === null || link === null) {
        return;
    }
    const restart = options.restart === true;
    const payload = { projectId: at.projectId, launchId, approve: options.approve, replace: options.replace };
    try {
        const result = await link.request(restart ? 'launch.restart' : 'launch.start', payload);
        if (result.outcome === 'held' && result.held !== undefined) {
            useLaunches.getState().setAsk({ kind: 'held', launchId, restart, held: result.held, replace: options.replace === true });
        } else if (result.outcome === 'busy' && result.busy !== undefined) {
            useLaunches.getState().setAsk({ kind: 'busy', launchId, restart, busy: result.busy, approve: options.approve === true });
        }
    } catch (e) {
        failed(i18next.t('launches:startFailed', { name: nameOf(at, launchId) }), e);
    }
};

export const stopLaunch = async (launchId: string, force = false): Promise<void> => {
    const at = target();
    const link = at === null ? null : transportFor(at.endpointId);
    if (at === null || link === null) {
        return;
    }
    try {
        await link.request('launch.stop', { projectId: at.projectId, launchId, force });
    } catch (e) {
        failed(i18next.t('launches:stopFailed', { name: nameOf(at, launchId) }), e);
    }
};

/* Every launch of the project that runs; a group stops through its members. */
export const stopAllLaunches = (): void => {
    const at = target();
    if (at === null) {
        return;
    }
    const statuses = useLaunches.getState().statuses[at.key] ?? {};
    for (const status of Object.values(statuses)) {
        if (status.state !== 'exited') {
            void stopLaunch(status.launchId);
        }
    }
};

export const chooseLaunch = (launchId: string): void => {
    const at = target();
    if (at !== null) {
        useUi.getState().chooseLaunch(at.key, launchId);
    }
};

/* The launch on the chip, as its id. */
export const chosenLaunchId = (): string | null => {
    const at = target();
    if (at === null) {
        return null;
    }
    const document = useLaunches.getState().documents[at.key];
    return document === undefined ? null : (chosenLaunch(document, useUi.getState().chosenLaunches[at.key])?.id ?? null);
};

/* What ⌥⌘R does: start the launch on the chip, or start it again while it runs. */
export const runChosenLaunch = (): void => {
    const at = target();
    const launchId = chosenLaunchId();
    if (at === null || launchId === null) {
        return;
    }
    const document = useLaunches.getState().documents[at.key];
    const statuses = useLaunches.getState().statuses[at.key] ?? {};
    const launch = document?.launches.find((candidate) => candidate.id === launchId);
    const ids = launch?.kind === 'group' ? (launch.launches ?? []) : [launchId];
    void startLaunch(launchId, { restart: ids.some((id) => statuses[id] !== undefined && statuses[id].state !== 'exited') });
};

export const stopChosenLaunch = (): void => {
    const launchId = chosenLaunchId();
    if (launchId !== null) {
        void stopLaunch(launchId);
    }
};

/* The launch's output in the panel, which also makes it the one on the chip. */
export const showLaunchOutput = (launchId?: string): void => {
    if (launchId !== undefined) {
        chooseLaunch(launchId);
    }
    useUi.getState().setPanel({ open: true, kind: 'launches' });
};

const originOf = (url: string): string | null => {
    try {
        return new URL(url).origin;
    } catch {
        return null;
    }
};

/* The page at a launch's address: the browser node that already shows it, else a new one on the canvas on screen. */
export const openLaunchAddress = (url: string): void => {
    const origin = originOf(url);
    for (const view of useDocument.getState().views) {
        if (view.kind === 'browser' && originOf(view.url) === origin) {
            revealNode(view.id);
            return;
        }
        if (!isCanvasView(view)) {
            continue;
        }
        const node = view.nodes.find((candidate) => candidate.kind === 'browser' && typeof candidate.url === 'string' && originOf(candidate.url) === origin);
        if (node !== undefined) {
            revealNode(node.id);
            return;
        }
    }
    void createNodeAction('browser', { url });
};
