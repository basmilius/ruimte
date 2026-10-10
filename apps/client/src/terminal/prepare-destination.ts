import { isCanvasView, type ProjectView, type SessionInfo } from '@ruimte/contracts';
import { focusNodeAction, focusViewAction } from '@/actions/client-actions';
import { liveCanvas } from '@/state/canvas';
import { useDocument } from '@/state/document';
import { endpointById, useEndpoints } from '@/state/endpoints';
import { useProject } from '@/state/project';
import { useSessions } from '@/state/sessions';
import { endpointKey } from '@/state/keys';
import { useWindow, windowWorkspace } from '@/state/window';
import { focusTerminal } from './registry';

function destinations(views: readonly ProjectView[]): Map<string, { viewId: string; canvas: boolean; signature: string }> {
    const entries = new Map<string, { viewId: string; canvas: boolean; signature: string }>();
    for (const view of views) {
        const nodes = isCanvasView(view) ? view.nodes : view.kind === 'terminal' ? [{ id: view.id, kind: view.kind, ...view.node }] : [];
        for (const node of nodes) {
            if (node.kind === 'terminal') {
                entries.set(node.id, {
                    viewId: view.id,
                    canvas: isCanvasView(view),
                    signature: JSON.stringify([view.id, node.cwd, node.command, node.provider, node.resume])
                });
            }
        }
    }
    return entries;
}

export type PrepareDestination = NonNullable<ReturnType<typeof prepareDestination>>;

/* A dialog owns these follows; switching workspace invalidates the whole operation permanently. */
export function prepareDestination(endpointId: string, machineId: string) {
    const workspace = windowWorkspace();
    const project = useProject.getState().current;
    if (!workspace || !project || workspace.connection.endpointId !== endpointId || endpointById(endpointId)?.daemonId !== machineId) {
        return null;
    }
    const projectId = project.projectId;
    const { transport, sessions } = workspace.connection;
    const targets = destinations(useDocument.getState().exportViews());
    const restarts = useSessions.getState().restarts;
    const releases: Array<() => void> = [];
    const subscriptions: Array<() => void> = [];
    const invalid = new Set<string>();
    const lives = new Map<string, Pick<SessionInfo, 'pid' | 'createdAt'>>();
    let disposed = false;
    let stale = false;

    const sameWorkspace = (): boolean => {
        return (
            windowWorkspace() === workspace &&
            useProject.getState().current?.projectId === projectId &&
            !useProject.getState().switching &&
            useProject.getState().currentEndpointId === endpointId &&
            endpointById(endpointId)?.daemonId === machineId &&
            transport.status === 'open'
        );
    };
    const current = (): boolean => {
        return !disposed && sameWorkspace();
    };
    const dispose = (): void => {
        disposed = true;
        subscriptions.splice(0).forEach((off) => off());
        releases.splice(0).forEach((release) => release());
    };
    const validate = (): void => {
        if (!current()) {
            stale ||= !sameWorkspace();
            dispose();
            return;
        }
        const now = destinations(useDocument.getState().exportViews());
        for (const [id, target] of targets) {
            const key = endpointKey(endpointId, id);
            if (
                now.get(id)?.signature !== target.signature ||
                useSessions.getState().restarts[key] !== restarts[key] ||
                useSessions.getState().byKey[key]?.exited !== undefined
            ) {
                invalid.add(id);
            }
        }
    };
    subscriptions.push(
        useWindow.subscribe(validate),
        useProject.subscribe(validate),
        useEndpoints.subscribe(validate),
        useDocument.subscribe(validate),
        useSessions.subscribe(validate),
        transport.subscribeStatus(validate)
    );

    return {
        dispose,
        current,
        canRestoreFocus: () => !stale && sameWorkspace(),
        async attach(): Promise<void> {
            const { sessions: list } = await transport.request('session.list', {});
            if (!current()) {
                return;
            }
            await Promise.all(
                list
                    .filter((info) => targets.has(info.sessionId) && !info.exited && !info.agent && !info.heldCommand)
                    .map(async (info) => {
                        lives.set(info.sessionId, { pid: info.pid, createdAt: info.createdAt });
                        try {
                            const release = await sessions.retain(info.sessionId);
                            if (current()) {
                                releases.push(release);
                            } else {
                                release();
                            }
                        } catch {
                            invalid.add(info.sessionId);
                        }
                    })
            );
        },
        async confirmed(id: string): Promise<boolean> {
            if (!current() || invalid.has(id) || !lives.has(id)) {
                return false;
            }
            const { sessions: list } = await transport.request('session.list', {}).catch(() => ({ sessions: [] }));
            validate();
            const live = list.find((info) => info.sessionId === id);
            return current() && !invalid.has(id) && live?.exited === false && live.pid === lives.get(id)?.pid && live.createdAt === lives.get(id)?.createdAt;
        },
        reveal(id: string): void {
            validate();
            const target = targets.get(id);
            if (!current() || invalid.has(id) || !target) {
                return;
            }
            focusViewAction(target.viewId);
            if (target.canvas) {
                focusNodeAction(target.viewId, id);
                liveCanvas(target.viewId)?.setBodyFocus(id);
            }
            useDocument.getState().setBodyFocused(true);
            // Already-mounted editors need an explicit focus; new mounts use TerminalBody's focused effect.
            focusTerminal(endpointId, id);
        }
    };
}
