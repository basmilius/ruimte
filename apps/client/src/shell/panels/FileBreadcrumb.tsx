import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Braces, ChevronRight, Hash, SquareFunction, Variable, type LucideIcon } from 'lucide-react';
import type { EditorBlock } from '@ruimte/smart-editor';
import { FileIcon, Icon } from '@basmilius/desktop-ui';
import { pathCrumbs } from '@/shell/panels/file-breadcrumb';

const KIND_ICONS: Record<string, LucideIcon> = {
    function: SquareFunction,
    method: SquareFunction,
    class: Box,
    interface: Braces,
    enum: Braces,
    type: Braces,
    variable: Variable,
    property: Hash
};

export interface FileBreadcrumbProps {
    path: string;
    /* The open project's folder, which the path is shown below. */
    folder: string | null;
    /* The named blocks around the caret, outermost first; empty before the editor has said. */
    scope: readonly EditorBlock[];
    onSelect(block: EditorBlock): void;
}

/*
 * Where in the project and in the file the caret is: the folders, the file, and the functions and
 * classes around the cursor, each of which takes the editor there.
 */
export function FileBreadcrumb({ path, folder, scope, onSelect }: FileBreadcrumbProps) {
    const { t } = useTranslation('panels');
    const { folders, name } = pathCrumbs(path, folder);
    const separator = <Icon icon={ChevronRight} size={12} className="shrink-0 text-text-faint" />;

    return (
        <nav aria-label={t('file.breadcrumb')} className="flex min-w-0 items-center gap-1 pl-1 text-xs text-text-muted">
            {folders.map((segment, index) => (
                <Fragment key={index}>
                    <span className="shrink-0 truncate">{segment}</span>
                    {separator}
                </Fragment>
            ))}
            <span className="flex min-w-0 shrink items-center gap-1 text-text">
                <FileIcon path={path} size={14} />
                <span className="truncate">{name}</span>
            </span>
            {scope.map((block) => (
                <Fragment key={`${block.startLine}:${block.name}`}>
                    {separator}
                    <button
                        type="button"
                        className="flex min-w-0 shrink-0 items-center gap-1 rounded-sm px-1 hover:bg-surface-hover hover:text-text"
                        onClick={() => onSelect(block)}
                    >
                        <Icon icon={KIND_ICONS[block.kind ?? ''] ?? Braces} size={12} className="shrink-0" />
                        <span className="max-w-48 truncate">{block.name}</span>
                    </button>
                </Fragment>
            ))}
        </nav>
    );
}
