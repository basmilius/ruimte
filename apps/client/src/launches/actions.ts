import { messageOf } from '@adecore/ui';
import { deviceMatches, type DeviceInfo, type DeviceReference, type LaunchConfigEntry, type LaunchesDocument } from '@ruimte/contracts';
import i18next from 'i18next';
import { OctagonX, Play, RotateCw, Square, type LucideIcon } from 'lucide-react';
import { createNodeAction, createViewAction } from '@/actions/client-actions';
import { chosenLaunch, type LaunchView } from '@/launches/model';
import { useLaunches, type LaunchOwner } from '@/launches/state';
import { nodesOfView } from '@/project/view-nodes';
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

/* Launches belong to the project on screen, on the machine it came from. One that names its owner acts
   only while that project is the one on screen, and does nothing once a person switched away. */
export function launchTarget(onScreen: LaunchOwner | null, owner?: LaunchOwner): Target | null {
    if (onScreen === null) {
        return null;
    }
    if (owner !== undefined && (owner.endpointId !== onScreen.endpointId || owner.projectId !== onScreen.projectId)) {
        return null;
    }
    return { ...onScreen, key: endpointKey(onScreen.endpointId, onScreen.projectId) };
}

export function projectOnScreen(): LaunchOwner | null {
    const { current, currentEndpointId } = defaultProjectStore.getState();
    return current === null || currentEndpointId === null ? null : { endpointId: currentEndpointId, projectId: current.projectId };
}

function target(owner?: LaunchOwner): Target | null {
    return launchTarget(projectOnScreen(), owner);
}

/* The target with the link to its machine, or null when either is missing. */
function linkedTarget(owner?: LaunchOwner): (Target & { link: NonNullable<ReturnType<typeof transportFor>> }) | null {
    const at = target(owner);
    const link = at === null ? null : transportFor(at.endpointId);
    return at === null || link === null ? null : { ...at, link };
}

function failed(title: string, e: unknown): void {
    useToasts.getState().show({ kind: 'error', title, description: messageOf(e) });
}

function nameOf(at: Target, launchId: string): string {
    return useLaunches.getState().documents[at.key]?.launches.find((launch) => launch.id === launchId)?.name ?? launchId;
}

interface StartOptions {
    restart?: boolean;
    /* A person said yes to what it runs, in the approval that asked. */
    approve?: boolean;
    /* Stop the launch that holds its port first. */
    replace?: boolean;
    /* The project it was asked from, for an ask that can outlive a switch of project. */
    owner?: LaunchOwner;
}

/* Starts a launch, or starts it again; what it has to ask a person first comes back as the store's `ask`. */
export async function startLaunch(launchId: string, options: StartOptions = {}): Promise<void> {
    const at = linkedTarget(options.owner);
    if (at === null) {
        return;
    }
    // The chip shows the launch a person used last.
    useUi.getState().chooseLaunch(at.key, launchId);
    const restart = options.restart === true;
    const payload = { projectId: at.projectId, launchId, approve: options.approve, replace: options.replace };
    try {
        const result = await at.link.request(restart ? 'launch.restart' : 'launch.start', payload);
        const owner = { endpointId: at.endpointId, projectId: at.projectId };
        if (result.outcome === 'held' && result.held !== undefined) {
            useLaunches.getState().setAsk({ kind: 'held', owner, launchId, restart, held: result.held, replace: options.replace === true });
        } else if (result.outcome === 'busy' && result.busy !== undefined) {
            useLaunches.getState().setAsk({ kind: 'busy', owner, launchId, restart, busy: result.busy, approve: options.approve === true });
        }
    } catch (e) {
        failed(i18next.t('launches:startFailed', { name: nameOf(at, launchId) }), e);
    }
}

export async function stopLaunch(launchId: string, force = false): Promise<void> {
    const at = linkedTarget();
    if (at === null) {
        return;
    }
    try {
        await at.link.request('launch.stop', { projectId: at.projectId, launchId, force });
    } catch (e) {
        failed(i18next.t('launches:stopFailed', { name: nameOf(at, launchId) }), e);
    }
}

/* Every launch of the project that runs; a group stops through its members. */
export function stopAllLaunches(): void {
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
}

/* A person's choice of the task to run after a worktree chat settles, or of none; choosing one approves it for worktrees. */
export async function chooseAfterSettle(launchId: string | null): Promise<void> {
    const at = linkedTarget();
    if (at === null) {
        return;
    }
    try {
        await at.link.request('launches.afterSettle', { projectId: at.projectId, launchId });
    } catch (e) {
        failed(i18next.t('launches:afterSettle.failed'), e);
    }
}

/* The tasks that may run after a worktree chat settles: a task with a command, never a service or a group. */
export function afterSettleCandidates(document: LaunchesDocument): LaunchConfigEntry[] {
    return document.launches.filter((launch) => launch.kind === 'task' && (launch.command ?? '').trim() !== '');
}

export function chooseLaunch(launchId: string): void {
    const at = target();
    if (at !== null) {
        useUi.getState().chooseLaunch(at.key, launchId);
    }
}

/* The launch on the chip, as its id. */
export function chosenLaunchId(): string | null {
    const at = target();
    if (at === null) {
        return null;
    }
    const document = useLaunches.getState().documents[at.key];
    return document === undefined ? null : (chosenLaunch(document, useUi.getState().chosenLaunches[at.key])?.id ?? null);
}

/* What ⌥⌘R does: start the launch on the chip, or start it again while it runs. */
export function runChosenLaunch(): void {
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
}

interface LaunchAction {
    key: string;
    icon: LucideIcon;
    label: string;
    iconClassName?: string;
    run(): void;
}

/* What a launch offers in its phase: a force stop while it stops, a restart and a stop while it runs, else a start. */
export function launchActions(view: LaunchView, t: (key: string, options?: Record<string, unknown>) => string): LaunchAction[] {
    const { id, name } = view.launch;
    if (view.phase === 'stopping') {
        return [{ key: 'force', icon: OctagonX, label: t('forceStop', { name }), run: () => void stopLaunch(id, true) }];
    }
    if (view.live) {
        return [
            { key: 'restart', icon: RotateCw, label: t('restart', { name }), run: () => void startLaunch(id, { restart: true }) },
            { key: 'stop', icon: Square, iconClassName: 'fill-current', label: t('stop', { name }), run: () => void stopLaunch(id) }
        ];
    }
    return [{ key: 'start', icon: Play, iconClassName: 'fill-current', label: t('start', { name }), run: () => void startLaunch(id) }];
}

export function stopChosenLaunch(): void {
    const launchId = chosenLaunchId();
    if (launchId !== null) {
        void stopLaunch(launchId);
    }
}

/* The launch's output in the panel, which also makes it the one on the chip. */
export function showLaunchOutput(launchId?: string, owner?: LaunchOwner): void {
    if (owner !== undefined && target(owner) === null) {
        return;
    }
    if (launchId !== undefined) {
        chooseLaunch(launchId);
    }
    useUi.getState().setPanel({ open: true, kind: 'launches' });
}

function originOf(url: string): string | null {
    try {
        return new URL(url).origin;
    } catch {
        return null;
    }
}

/* Reveals the first view, or else node within it, that shows what `shows` looks for; false when none does. */
function revealShowing(shows: (item: { kind: string; url?: unknown; device?: DeviceReference }) => boolean): boolean {
    for (const view of useDocument.getState().views) {
        const found = shows(view) ? view : nodesOfView(view).find(shows);
        if (found !== undefined) {
            revealNode(found.id);
            return true;
        }
    }
    return false;
}

/* The page at a launch's address: the browser node that already shows it, else a new one on the canvas on screen. */
export function openLaunchAddress(url: string): void {
    const origin = originOf(url);
    if (!revealShowing((item) => item.kind === 'browser' && typeof item.url === 'string' && originOf(item.url) === origin)) {
        void createNodeAction('browser', { url });
    }
}

/* The device a launch runs on: the node or view that already shows it, else a new device view. */
export function showLaunchDevice(device: DeviceInfo): void {
    if (!revealShowing((item) => item.kind === 'device' && item.device !== undefined && deviceMatches(device, item.device))) {
        void createViewAction('device', { device: { platform: device.platform, kind: device.kind, name: device.name, runtime: device.runtime } });
    }
}
