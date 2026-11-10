import { lazyDialog } from '@adecore/ui';
import type { AgentKind } from '@ruimte/contracts';
import { LinkRequestDialog } from '@/machine-ui/LinkRequestDialog';
import { MachineUpdateDialog } from '@/machine-ui/MachineUpdateDialog';
import { createDialogState } from '@/registry/dialog-state';
import type { DialogContribution } from '@/registry/dialogs';

/*
 * A node being made on another machine, from the new-node menu, or a machine that stopped linking the
 * project being linked again (`relink`), which asks for its checkout once more.
 */
export interface RemoteNodeRequest {
    machineId: string;
    kind: 'chat' | 'terminal' | 'device';
    /* The canvas it goes on; null for a machine linked again, which makes no node. */
    viewId: string | null;
    /* Where on the canvas it goes, in world units; null lets the canvas place it. */
    at: { x: number; y: number } | null;
    relink: boolean;
    /*
     * A fork of this chat after this turn: the new chat starts from a transcript of the original instead of from nothing.
     * `source` is the daemon id of the machine the original runs on, absent for the workspace's.
     */
    handoff?: { chatId: string; turnId: string; title: string; provider?: AgentKind; source?: string };
}

/* A project being put on another machine; `then` is the node that was being made there, which opens again once the clone is in. */
export interface AddToMachineRequest {
    machineId: string | null;
    then?: RemoteNodeRequest;
}

export const remoteNodeDialog = createDialogState<RemoteNodeRequest>();
export const addToMachineDialog = createDialogState<AddToMachineRequest>();

const RemoteNodeDialog = lazyDialog(
    () => import('@/machine-ui/RemoteNodeDialog'),
    'RemoteNodeDialog',
    remoteNodeDialog.store,
    (state) => state.request !== null
);
const AddToMachineDialog = lazyDialog(
    () => import('@/machine-ui/AddToMachineDialog'),
    'AddToMachineDialog',
    addToMachineDialog.store,
    (state) => state.request !== null
);

export const MACHINE_DIALOGS: readonly DialogContribution[] = [
    { id: 'remote-node', surface: 'dialog', component: RemoteNodeDialog },
    { id: 'add-to-machine', surface: 'dialog', component: AddToMachineDialog }
];

export const MACHINE_WINDOW_DIALOGS: readonly DialogContribution[] = [
    { id: 'machine-update', surface: 'machineUpdate', component: MachineUpdateDialog },
    { id: 'link-request', surface: 'link', component: LinkRequestDialog }
];
