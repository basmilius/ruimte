import { FileText, FileWarning, LoaderCircle } from 'lucide-react';
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
    return renderFile({ path, name, read: state.read });
}

/* The preview panel's body: whichever tab is up, under the strip that names them. */
export function FileViewer() {
    const active = useFiles((s) => s.active);

    if (!active) {
        return (
            <div className="grid min-h-0 grow place-items-center">
                <EmptyState icon={<Icon icon={FileText} size={20} />}>Open a file from the files panel to read it here.</EmptyState>
            </div>
        );
    }

    return (
        // Keyed on the path, so switching tabs starts a read of its own instead of drawing the file before it.
        <div className="flex min-h-0 min-w-0 grow flex-col justify-center">
            <FileBody key={active} path={active} name={basenameOf(active)} />
        </div>
    );
}
