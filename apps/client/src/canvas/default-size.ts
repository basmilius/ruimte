import { formatNumber } from '@adecore/ui/format';
import { fitNodeSize, type NodeKind, type NodeSize } from '@ruimte/contracts';
import i18next from 'i18next';
import { perform } from '@/actions/client-actions';
import { endpointById } from '@/state/endpoints';
import { useToasts } from '@/state/toasts';

/* A size as a person reads it: width by height, in their region's digits. */
export function formatNodeSize(size: NodeSize): string {
    return `${formatNumber(size.w)} × ${formatNumber(size.h)}`;
}

function kindName(kind: NodeKind): string {
    return i18next.t(`shell:nodeKinds.${kind}`);
}

/* A node's frame becomes what new nodes of its kind start at on the machine, and a toast says what was kept. */
export async function makeDefaultSize(endpointId: string, kind: NodeKind, frame: NodeSize): Promise<void> {
    const size = fitNodeSize(frame);
    const words = { kind: kindName(kind), size: formatNodeSize(size) };
    try {
        await perform('machine.setNodeSize', { endpointId, kind, size });
        useToasts.getState().show({
            id: `node-size-${endpointId}-${kind}`,
            kind: 'success',
            title: i18next.t('canvas:defaultSize.saved', words),
            description: i18next.t('canvas:defaultSize.savedDescription', { machine: endpointById(endpointId)?.label ?? endpointId })
        });
    } catch (e) {
        useToasts.getState().show({
            id: `node-size-${endpointId}-${kind}`,
            kind: 'error',
            title: i18next.t('canvas:defaultSize.failed', words),
            description: e instanceof Error ? e.message : undefined
        });
    }
}

/*
 * Sets the size of a kind on the machine from settings, null putting it back to the built-in one. A
 * failure is said in a toast, since the row has no room for it.
 */
export async function setDefaultSize(endpointId: string, kind: NodeKind, size: NodeSize | null): Promise<void> {
    try {
        await perform('machine.setNodeSize', { endpointId, kind, size });
    } catch (e) {
        useToasts.getState().show({
            id: `node-size-${endpointId}-${kind}`,
            kind: 'error',
            title:
                size === null
                    ? i18next.t('canvas:defaultSize.resetFailed', { kind: kindName(kind) })
                    : i18next.t('canvas:defaultSize.failed', { kind: kindName(kind) }),
            description: e instanceof Error ? e.message : undefined
        });
    }
}
