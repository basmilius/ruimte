import type { AgentKind } from '@ruimte/contracts';
import { createDialogState } from '@/registry/dialog-state';

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
    name: string;
}

/* A provider's install or sign-in command, typed into a shell of its own for the person to run. */
export interface ProviderCommandRequest {
    endpointId: string;
    kind: AgentKind;
    command: string;
}

export const forkDialog = createDialogState<ForkRequest>();
export const loginDialog = createDialogState<LoginRequest>();
export const providerCommandDialog = createDialogState<ProviderCommandRequest>();
