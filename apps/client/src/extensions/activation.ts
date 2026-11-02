import { onClientEvent } from '@/extensions/client-events';
import { extensionKeyOf } from '@/extensions/registry';
import { nodeInfoOf } from '@/extensions/slots';
import { focusedCanvas } from '@/state/canvas';
import { useDocument } from '@/state/document';
import { useFiles } from '@/state/files';

/*
 * Whether this manifest wants loading now. Without `activation`, or with `start`, always. A node or view counts only
 * when it is this extension's: another one may name a type the same.
 */
export function wantsLoading(extensionId: string, activation: readonly string[] | undefined): boolean {
    if (activation === undefined || activation.includes('start')) {
        return true;
    }

    const nodeKeys = Object.keys(focusedCanvas().getState().nodes).flatMap((id) => {
        const { extension } = nodeInfoOf(id);

        return extension === undefined ? [] : [`${extension.id}/${extension.type}`];
    });
    const { views, activeViewId } = useDocument.getState();
    // A view of an extension is kept as `unknown`, with what the extension stored under `raw`.
    const active = views.find((view) => view.id === activeViewId);
    const viewKey = active?.kind === 'unknown' ? extensionKeyOf(active.raw) : null;
    const files = useFiles.getState().tabs.map((tab) => tab.key.toLowerCase());

    return activation.some((event) => {
        const [kind, value = ''] = event.split(':');
        const key = `${extensionId}/${value}`;

        return kind === 'node'
            ? nodeKeys.includes(key)
            : kind === 'view'
              ? viewKey === key
              : kind === 'file' && files.some((tabKey) => tabKey.endsWith(`.${value.toLowerCase()}`));
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
