import { useMemo } from 'react';
import { FileText, FileWarning, LoaderCircle } from 'lucide-react';
import { DiffFile } from '@/shell/panels/DiffFile';
import { FileActionsContext } from '@/shell/panels/file-actions';
import { basenameOf } from '@/shell/panels/files-tree';
import { renderFile } from '@/shell/panels/renderers';
import { useFileRead } from '@/shell/panels/use-file-read';
import { useFiles } from '@/state/files';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/EmptyState';
import { Icon } from '@/ui/Icon';

/*
 * The open file, read and drawn. The read lives here and not in the renderers, so the whole viewer
 * has one loading state and one error state, and a renderer only ever sees a file that is there.
 */
function FileBody({ path, name }: { path: string; name: string }) {
    const { state, retry } = useFileRead(path);
    const actions = useMemo(() => ({ key: path, path, name, refresh: retry }), [path, name, retry]);

    if (state.status === 'loading') {
        return <EmptyState icon={<Icon icon={LoaderCircle} size={20} className="animate-spin" />}>Reading {name}.</EmptyState>;
    }
    if (state.status === 'error') {
        return (
            <EmptyState
                icon={<Icon icon={FileWarning} size={20} />}
                action={
                    <Button variant="secondary" size="sm" onClick={retry}>
                        Try again
                    </Button>
                }
            >
                {state.message}
            </EmptyState>
        );
    }
    return <FileActionsContext.Provider value={actions}>{renderFile({ path, name, read: state.read })}</FileActionsContext.Provider>;
}

/* The preview panel's body: whichever tab is up, under the strip that names them. */
export function FileViewer() {
    const active = useFiles((s) => s.active);
    const tab = useFiles((s) => s.tabs.find((entry) => entry.key === s.active) ?? null);

    if (!active || !tab) {
        return (
            <div className="grid min-h-0 grow place-items-center">
                <EmptyState icon={<Icon icon={FileText} size={20} />}>Open a file from the files panel to read it here.</EmptyState>
            </div>
        );
    }

    return (
        // Keyed on the tab, so switching tabs starts a read of its own instead of drawing the file before it.
        <div className="flex min-h-0 min-w-0 grow flex-col justify-center">
            {tab.view ? (
                <DiffFile key={tab.key} tabKey={tab.key} path={tab.path} name={basenameOf(tab.path)} view={tab.view} />
            ) : (
                <FileBody key={tab.key} path={tab.path} name={basenameOf(tab.path)} />
            )}
        </div>
    );
}
