import { onClientEvent } from '@/extensions/client-events';
import { nodeInfoOf } from '@/extensions/slots';
import { focusedCanvas } from '@/state/canvas';
import { useDocument } from '@/state/document';
import { useFiles } from '@/state/files';

/* Whether this manifest wants loading now. Without `activation`, or with `start`, always. */
export function wantsLoading(activation: readonly string[] | undefined): boolean {
    if (activation === undefined || activation.includes('start')) {
        return true;
    }

    const nodes = Object.keys(focusedCanvas().getState().nodes).map(nodeInfoOf);
    const { views, activeViewId } = useDocument.getState();
    const raw = views.find((view) => view.id === activeViewId) as { extension?: string; type?: string } | undefined;
    const files = useFiles.getState().tabs.map((tab) => tab.key.toLowerCase());

    return activation.some((event) => {
        const [kind, value = ''] = event.split(':');

        return kind === 'node'
            ? nodes.some((node) => node.extension?.type === value)
            : kind === 'view'
              ? raw?.type === value
              : kind === 'file' && files.some((key) => key.endsWith(`.${value.toLowerCase()}`));
    });
}

/* Calls back whenever one of those may have become true. */
export function watchActivation(check: () => void): () => void {
    const stops = [onClientEvent('node.added', check), onClientEvent('view.changed', check), useFiles.subscribe(check)];

    return () => stops.forEach((stop) => stop());
}
