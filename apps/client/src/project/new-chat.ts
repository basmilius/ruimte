import i18next from 'i18next';
import { create } from 'zustand';
import { ensureMachine } from '@/endpoint/reach';
import { listProjects } from '@/project/list';
import { isOpenHere, openProject } from '@/project/open';
import { usePulsarAccount } from '@/pulsar/account';
import { usePulsarMachines } from '@/pulsar/machines';
import { mergeMachines } from '@/shell/settings/machine-list';
import { useDocument } from '@/state/document';
import { LOCAL_ENDPOINT_ID, useEndpoints } from '@/state/endpoints';
import { hasLocalMachine } from '@/state/local-machine';
import { useProject } from '@/state/project';
import { useToasts } from '@/state/toasts';
import { useUi } from '@/state/ui';
import { useWindow, windowWorkspace, workspaceOf } from '@/state/window';
import { transportFor } from '@/transport';
import { TransportError } from '@/transport/transport';

/* A machine whose home sits in a git checkout, and one from before chats outside a project. Neither says a word: the ways in go. */
const REFUSALS: readonly string[] = ['scratch-unavailable', 'unknown-request'];

interface NewChatState {
    /* The machines that turned a new chat down, for as long as this page runs. */
    refused: Record<string, true>;
}

export const useNewChat = create<NewChatState>(() => ({ refused: {} }));

const refuse = (...endpointIds: string[]): void => {
    useNewChat.setState((state) => ({ refused: { ...state.refused, ...Object.fromEntries(endpointIds.map((id) => [id, true as const])) } }));
};

/*
 * The machine a new chat starts on from this window: the one of the open project, or this machine on
 * the desktop's start screen. Null where a person picks one, which is the web client's start screen.
 */
export const newChatMachine = (
    workspaceEndpointId: string | null = windowWorkspace()?.connection.endpointId ?? null,
    local = hasLocalMachine()
): string | null => workspaceEndpointId ?? (local ? LOCAL_ENDPOINT_ID : null);

/* Whether this window offers a new chat at all. One a person picks the machine for is offered until they pick one that refuses. */
export const offersNewChat = (machine: string | null, refused: Record<string, true>): boolean => machine === null || refused[machine] !== true;

export const useOffersNewChat = (): boolean => {
    const workspaceEndpointId = useWindow((s) => workspaceOf(s.content)?.connection.endpointId ?? null);
    const refused = useNewChat((s) => s.refused);
    return offersNewChat(newChatMachine(workspaceEndpointId), refused);
};

/* Puts the view in front once the document has it: the change that adds it may land just after the reply that names it. */
const showViewOnceThere = (viewId: string): void => {
    const show = (): boolean => {
        const state = useDocument.getState();
        if (!state.views.some((view) => view.id === viewId)) {
            return false;
        }
        state.setActiveView(viewId);
        return true;
    };
    if (show()) {
        return;
    }
    const projectId = useProject.getState().current?.projectId ?? null;
    const stop = useDocument.subscribe(() => {
        if (useProject.getState().current?.projectId !== projectId || show()) {
            stop();
        }
    });
};

/* The chat on screen: in this window when it has the project already or can take it. */
const showNewChat = async (endpointId: string, projectId: string, viewId: string): Promise<void> => {
    if (!isOpenHere(endpointId, projectId)) {
        const outcome = await openProject(endpointId, projectId);
        if (outcome !== 'done' || !isOpenHere(endpointId, projectId)) {
            return;
        }
    }
    showViewOnceThere(viewId);
};

/* A chat outside any project on one machine, which makes it in its Chats project and shows it. */
export const newChatOn = async (endpointId: string): Promise<void> => {
    let id = endpointId;
    try {
        id = await ensureMachine(endpointId);
        const transport = transportFor(id);
        if (!transport) {
            return;
        }
        const { summary, viewId } = await transport.request('project.newChat', {});
        void listProjects(id).catch(() => undefined);
        await showNewChat(id, summary.projectId, viewId);
    } catch (e) {
        if (e instanceof TransportError && REFUSALS.includes(e.code)) {
            refuse(endpointId, id);
            return;
        }
        useToasts.getState().show({ kind: 'error', title: i18next.t('common:state.error'), description: e instanceof Error ? e.message : String(e) });
    }
};

/* The machines a person picks between where no machine is implied, in the order the Machines pane lists them. */
const pickableMachines = (): string[] => {
    const account = usePulsarAccount.getState().status === 'signed-in' ? usePulsarMachines.getState().machines : null;
    return mergeMachines({ endpoints: useEndpoints.getState().endpoints, accountMachines: account, showLocal: hasLocalMachine() }).map(
        (entry) => entry.endpoint?.id ?? entry.id
    );
};

/* New chat from the tile, the palette, the menu and the shortcut alike. */
export const newChat = (): void => {
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
};
