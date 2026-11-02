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

function tabKeys(tabs: readonly { key: string }[]): string {
    return tabs.map((tab) => tab.key).join('\n');
}

// A burst, such as a pasted group of nodes or a project opening its tabs, asks once.
const SETTLE_MS = 100;

/* Calls back once one of those may have become true: after a node came, the view changed or a tab opened. */
export function watchActivation(check: () => void): () => void {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const soon = (): void => {
        if (timer === null) {
            timer = setTimeout(() => {
                timer = null;
                check();
            }, SETTLE_MS);
        }
    };
    const stops = [
        onClientEvent('node.added', soon),
        onClientEvent('view.changed', soon),
        // Only which files are open, not what changes inside a tab.
        useFiles.subscribe((state, previous) => {
            if (state.tabs !== previous.tabs && tabKeys(state.tabs) !== tabKeys(previous.tabs)) {
                soon();
            }
        })
    ];

    return () => {
        stops.forEach((stop) => stop());

        if (timer !== null) {
            clearTimeout(timer);
        }
    };
}
