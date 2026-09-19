import { useTranslation } from 'react-i18next';
import { FileQuestion } from 'lucide-react';
import type { FileSurfaceKind } from '@/shell/panels/FileActionItems';
import { FileBody } from '@/shell/panels/FileBody';
import { basenameOf, resolveStoredPath } from '@/shell/panels/files-tree';
import { useProject } from '@/state/project';
import { EmptyState } from '@/ui/EmptyState';
import { Icon } from '@/ui/Icon';

/*
 * The file a node or a view points at. Both hold a path and nothing else, so both resolve it
 * against the project folder here and hand the rest to the same reading layer the preview uses.
 */
export function FileSurface({ path, on }: { path: string | null; on: FileSurfaceKind }) {
    const { t } = useTranslation('panels');
    const folder = useProject((s) => s.current?.folder ?? null);
    const resolved = path === null ? null : resolveStoredPath(folder, path);

    if (resolved === null) {
        return (
            <EmptyState icon={<Icon icon={FileQuestion} size={16} />} className="h-full">
                {t('file.noFile')}
            </EmptyState>
        );
    }

    return (
        // Keyed on the path, so pointing at another file starts a read of its own.
        <div className="flex h-full min-h-0 w-full flex-col">
            <FileBody key={resolved} path={resolved} name={basenameOf(resolved)} on={on} />
        </div>
    );
}
