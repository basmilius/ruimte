import { messageOf } from '@adecore/ui';
import type { ProjectNewChatPayload, RuntimeMode } from '@ruimte/contracts';
import i18next from 'i18next';
import { create } from 'zustand';
import { openChatInMode } from '@/action-port/opening-mode';
import { listProjects } from '@/clients/project/list';
import { desktop } from '@/desktop/bridge';
import { liveMachineEntries } from '@/machines/use-machine-entries';
import { isOpenHere, openProject } from '@/project/open';
import { showViewOnceThere } from '@/project/show-view-once';
import { LOCAL_ENDPOINT_ID } from '@/state/endpoints';
import { endpointKey } from '@/state/keys';
import { hasLocalMachine } from '@/state/local-machine';
import { useToasts } from '@/state/toasts';
import { useUi } from '@/state/ui';
import { transportFor } from '@/transport';
import { TransportError, fireAndForget } from '@/transport-api/transport';
import { ensureMachine } from '@/workspace/reach';
import { useWindow, windowWorkspace, workspaceOf } from '@/workspace/window';

/* A machine whose home sits in a git checkout has no Chats project. It says no word: the ways in go. */
const REFUSALS: readonly string[] = ['scratch-unavailable'];

interface NewChatState {
    refused: Record<string, true>;
}

export const useNewChat = create<NewChatState>(() => ({ refused: {} }));

function refuse(...endpointIds: string[]): void {
    useNewChat.setState((state) => ({ refused: { ...state.refused, ...Object.fromEntries(endpointIds.map((id) => [id, true as const])) } }));
}

/*
 * The machine a new chat starts on from this window: the one of the open project, or this machine on
 * the desktop's start screen. Null where a person picks one, which is the web client's start screen.
 */
export function newChatMachine(
    workspaceEndpointId: string | null = windowWorkspace()?.connection.endpointId ?? null,
    local = hasLocalMachine()
): string | null {
    return workspaceEndpointId ?? (local ? LOCAL_ENDPOINT_ID : null);
}

/* Whether this window offers a new chat at all. One a person picks the machine for is offered until they pick one that refuses. */
export function offersNewChat(machine: string | null, refused: Record<string, true>): boolean {
    return machine === null || refused[machine] !== true;
}

export function useOffersNewChat(): boolean {
    const workspaceEndpointId = useWindow((s) => workspaceOf(s.content)?.connection.endpointId ?? null);
    const refused = useNewChat((s) => s.refused);
    return offersNewChat(newChatMachine(workspaceEndpointId), refused);
}

/*
 * The chat on screen, in the project that holds it. The window switches to that project itself, and
 * hands the chat on to the shell when the claim found the project in another window, which then comes to the front.
 */
export async function showChatIn(endpointId: string, projectId: string, viewId: string): Promise<void> {
    if (isOpenHere(endpointId, projectId)) {
        showViewOnceThere(viewId);
        return;
    }
    const outcome = await openProject(endpointId, projectId);
    if (outcome !== 'done') {
        return;
    }
    if (isOpenHere(endpointId, projectId)) {
        showViewOnceThere(viewId);
        return;
    }
    desktop()?.openWindow?.(endpointKey(endpointId, projectId), viewId);
}

/*
 * A chat outside any project on one machine, which makes it in its Chats project and shows it. The
 * machine shows the chat nobody wrote in yet instead when there is one, of the CLI and account the
 * payload names when it names one, in the mode given or else the default. False when no chat came.
 */
export async function newChatOn(endpointId: string, payload: ProjectNewChatPayload = {}, runtimeMode?: RuntimeMode): Promise<boolean> {
    let id = endpointId;
    try {
        id = await ensureMachine(endpointId);
        const transport = transportFor(id);
        if (!transport) {
            return false;
        }
        const { summary, viewId } = await transport.request('project.newChat', payload);
        void fireAndForget('listProjects', listProjects(id));
        if (runtimeMode !== undefined) {
            openChatInMode(id, viewId, runtimeMode);
        }
        await showChatIn(id, summary.projectId, viewId);
        return true;
    } catch (e) {
        if (e instanceof TransportError && REFUSALS.includes(e.code)) {
            refuse(endpointId, id);
            return false;
        }
        useToasts.getState().show({ kind: 'error', title: i18next.t('common:state.error'), description: messageOf(e) });
        return false;
    }
}

function pickableMachines(): string[] {
    return liveMachineEntries().map((entry) => entry.endpoint?.id ?? entry.id);
}

export function newChat(): void {
    const machine = newChatMachine();
    if (machine !== null) {
        if (offersNewChat(machine, useNewChat.getState().refused)) {
            void newChatOn(machine);
        }
        return;
    }
    const machines = pickableMachines();
    if (machines.length === 1) {
        void newChatOn(machines[0]!);
        return;
    }
    useUi.getState().openChatMachines();
}
