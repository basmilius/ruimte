import { FileText } from 'lucide-react';
import { DiffFile } from '@/shell/panels/DiffFile';
import { FileBody } from '@/shell/panels/FileBody';
import { basenameOf } from '@/shell/panels/files-tree';
import { useFiles } from '@/state/files';
import { EmptyState } from '@/ui/EmptyState';
import { Icon } from '@/ui/Icon';

/* The preview panel's body: whichever tab is up, under the strip that names them. */
export function FileViewer() {
    const active = useFiles((s) => s.active);
    const tab = useFiles((s) => s.tabs.find((entry) => entry.key === s.active) ?? null);

    if (!active || !tab) {
        return (
            <div className="grid min-h-0 grow place-items-center">
                <EmptyState icon={<Icon icon={FileText} size={20} />}>Open a file from the Files panel.</EmptyState>
            </div>
        );
    }

    return (
        // Keyed on the tab, so switching tabs starts a read of its own instead of drawing the file before it.
        <div className="flex min-h-0 min-w-0 grow flex-col justify-center">
            {tab.view ? (
                <DiffFile key={tab.key} tabKey={tab.key} path={tab.path} name={basenameOf(tab.path)} view={tab.view} />
            ) : (
                <FileBody key={tab.key} path={tab.path} name={basenameOf(tab.path)} on="tab" tabKey={tab.key} />
            )}
        </div>
    );
}
