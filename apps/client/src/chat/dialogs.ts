import { lazyDialog } from '@adecore/ui';
import type { AgentKind } from '@ruimte/contracts';
import { useStore } from 'zustand';
import { ChatChooserMenu } from '@/chat/ChatChooserMenu';
import { ForkDialog } from '@/chat/ForkDialog';
import { createDialogState } from '@/registry/dialog-state';
import type { DialogContribution } from '@/registry/dialogs';
import { imageSaveDialog, type ImageSaveDialogState } from '@/surface/image-save';

/* A fork of a chat after a turn; `machine` is the daemon id of the machine the chat runs on, absent for the workspace's. */
interface ForkRequest {
    chatId: string;
    turnId: string;
    machine?: string;
}

/* A CLI's own login in a terminal of its own, for a machine no canvas on screen can hold a terminal node of. */
export interface LoginRequest {
    endpointId: string;
    kind: AgentKind;
    accountId: string;
    /* What a person calls the account. */
    name: string;
}

/* A provider's install or sign-in command, typed into a shell of its own for the person to run. */
export interface ProviderCommandRequest {
    endpointId: string;
    kind: AgentKind;
    command: string;
}

/* The chat and the turn a fork goes on after, while its dialog is up. */
export const forkDialog = createDialogState<ForkRequest>();
export const loginDialog = createDialogState<LoginRequest>();
export const providerCommandDialog = createDialogState<ProviderCommandRequest>();

const LoginDialog = lazyDialog(
    () => import('@/chat/LoginDialog'),
    'LoginDialog',
    loginDialog.store,
    (state) => state.request !== null
);
const ProviderCommandDialog = lazyDialog(
    () => import('@/chat/ProviderCommandDialog'),
    'ProviderCommandDialog',
    providerCommandDialog.store,
    (state) => state.request !== null
);

const ImageSaveHost = lazyDialog(
    () => import('@/chat/ImageSaveHost'),
    'ImageSaveHost',
    (select: (state: ImageSaveDialogState) => boolean) => useStore(imageSaveDialog, select),
    (state) => state.session !== null
);

/* The fork dialog brings its own boundary. */
export const CHAT_WORKSPACE_DIALOGS: readonly DialogContribution[] = [
    { id: 'chat-chooser', surface: 'dialog', component: ChatChooserMenu },
    { id: 'fork', surface: null, component: ForkDialog },
    { id: 'image-save', surface: 'dialog', component: ImageSaveHost }
];

export const CHAT_WINDOW_DIALOGS: readonly DialogContribution[] = [
    { id: 'login', surface: 'login', component: LoginDialog },
    { id: 'provider-command', surface: 'providerCommand', component: ProviderCommandDialog }
];
