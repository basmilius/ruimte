import { messageOf } from '@adecore/ui';
import type { TerminalShell } from '@ruimte/contracts';
import type { BrokerSetting } from '@ruimte/pulsar';
import i18next from 'i18next';
import { useState } from 'react';
import { perform } from '@/action-port/perform';
import type { MachineSwitch } from '@/machine-ui/machine-switches';
import type { Endpoint } from '@/state/endpoints';
import { useToasts } from '@/state/toasts';
import { transportFor } from '@/transport/index';

export interface MachineSettingPatch extends Partial<Record<MachineSwitch, boolean>> {
    readonly broker?: BrokerSetting;
    readonly lanDoor?: boolean;
    readonly streamingAllowed?: boolean;
    readonly steerMessages?: boolean;
    readonly worktreeRoot?: string;
    readonly terminalShell?: TerminalShell;
    readonly usageStats?: boolean;
}

function folderRefusal(e: unknown): string | null {
    switch ((e as { code?: unknown } | null)?.code) {
        case 'root-refused':
            return i18next.t('settings:machine.worktreeFolder.refusedRoot');
        case 'not-a-folder':
            return i18next.t('settings:machine.worktreeFolder.notAFolder');
        default:
            return null;
    }
}

export async function saveMachineSetting(
    endpoint: Endpoint,
    patch: MachineSettingPatch,
    /* A refused folder is the person's to fix in the field, so it is told there and not in a toast. */
    onRefused?: (message: string) => void
): Promise<boolean> {
    if (!transportFor(endpoint.id)) {
        return false;
    }

    try {
        await perform('machine.setIdentity', { endpointId: endpoint.id, ...patch });
        return true;
    } catch (e) {
        const refusal = folderRefusal(e);

        if (onRefused !== undefined && refusal !== null) {
            onRefused(refusal);
            return false;
        }

        useToasts.getState().show({
            id: `endpoint-setting-${endpoint.id}`,
            kind: 'error',
            title: i18next.t('settings:machine.toast.saveFailed', { machine: endpoint.label }),
            description: refusal ?? messageOf(e, i18next.t('settings:machine.toast.unchanged'))
        });

        return false;
    }
}

/* Saves one machine setting at a time; `busy` holds the control still until the machine answered. */
export function useMachineSetting(endpoint: Endpoint): { busy: boolean; save(patch: MachineSettingPatch): Promise<void> } {
    const [busy, setBusy] = useState(false);

    const save = async (patch: MachineSettingPatch): Promise<void> => {
        setBusy(true);
        await saveMachineSetting(endpoint, patch);
        setBusy(false);
    };

    return { busy, save };
}
