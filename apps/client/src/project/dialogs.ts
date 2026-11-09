import { lazyDialog } from '@adecore/ui';
import { useAgentCloseAsk, useAgentFolderAsk } from '@/project/agent-asks';
import { createDialogState, createFlagState } from '@/registry/dialog-state';
import type { DialogContribution } from '@/registry/dialogs';

/*
 * A chat in Chats that leaves it. `make` starts a new project from the chat ("Make project…"); `pick`
 * moves it into a project that already exists, `projectId` being the one chosen beforehand, if any.
 */
export interface MoveChatRequest {
    chatId: string;
    mode: 'make' | 'pick';
    projectId: string | null;
    /* What an agent in the chat suggested, which the form starts from: a name and, when it gave one, a folder. */
    suggest?: { name: string; folder?: string };
}

export const moveChatDialog = createDialogState<MoveChatRequest>();

/* The application menu asks for the open project's settings; the project menu owns that dialog. */
export const projectSettingsAsk = createFlagState();

const MoveChatDialog = lazyDialog(
    () => import('@/project/MoveChatDialog'),
    'MoveChatDialog',
    moveChatDialog.store,
    (state) => state.request !== null
);

const AgentCloseDialog = lazyDialog(
    () => import('@/project/AgentCloseDialog'),
    'AgentCloseDialog',
    useAgentCloseAsk,
    (state) => state.ask !== null
);

const AgentOpenFolderDialog = lazyDialog(
    () => import('@/project/AgentOpenFolderDialog'),
    'AgentOpenFolderDialog',
    useAgentFolderAsk,
    (state) => state.ask !== null
);

export const PROJECT_DIALOGS: readonly DialogContribution[] = [
    { id: 'agent-close', surface: 'dialog', component: AgentCloseDialog },
    { id: 'agent-open-folder', surface: 'dialog', component: AgentOpenFolderDialog },
    { id: 'move-chat', surface: 'dialog', component: MoveChatDialog }
];

/* What a view is being asked about, from the sidebar, the breadcrumb or the palette alike. */
type ViewDialog =
    | { kind: 'settings'; viewId: string }
    /* Promoting a node that has lines drawn into it. Those lines do not survive the move. */
    | { kind: 'promote'; nodeId: string }
    | { kind: 'new-browser' };

export const viewDialog = createDialogState<ViewDialog>();

/* The sidebar row the caret is in, which is how a new heading opens. */
export const renamingView = createDialogState<string>();
