import { useTranslation } from 'react-i18next';
import { Copy, FileDiff, FileText } from 'lucide-react';
import type { DiffSourceLine } from '@adecore/merge';
import { ignoreRefusal, perform } from '@/actions/client-actions';
import { FileActionItems } from '@/shell/panels/FileActionItems';
import { absoluteOf } from '@/shell/panels/files-tree';
import { copyText, Icon, Menu } from '@adecore/ui';

interface DiffRowMenuItemsProps {
    /* The folder the row's path counts from: the repository of a commit or a checkout. */
    cwd: string;
    /* Relative to `cwd`, as the diff names it. */
    path: string;
    /* The diff deletes it, so there is no file on disk to show, open or reveal. */
    gone: boolean;
    /* The commit the row is part of; absent outside one. */
    commit?: string;
    /* Where the caret of this row's diff stands in the file, when its diff is on screen. */
    caret?: DiffSourceLine;
    onOpenChanges(): void;
}

/*
 * A file of a commit, a checkout's changes, a patch or a conflict. Those lists are read and not
 * staged (`apps/server/src/git/CLAUDE.md`), so nothing here stages or discards.
 */
export function DiffRowMenuItems({ cwd, path, gone, commit, caret, onOpenChanges }: DiffRowMenuItemsProps) {
    const { t } = useTranslation('panels');
    const absolute = absoluteOf(cwd, path);
    return (
        <>
            <Menu.Item onClick={onOpenChanges}>
                <Icon icon={FileDiff} size={14} /> {t('git.list.openChanges')}
            </Menu.Item>
            <Menu.Item
                disabled={gone}
                onClick={() => void perform('file.preview', { path: absolute, line: caret?.line ?? null, column: caret?.column }).catch(ignoreRefusal)}
            >
                <Icon icon={FileText} size={14} /> {caret === undefined ? t('file.tab.openItself') : t('file.tab.openItselfAt', { line: caret.line })}
            </Menu.Item>
            <Menu.Separator />
            <FileActionItems path={absolute} on="list" gone={gone} />
            {commit !== undefined && (
                <Menu.Item onClick={() => copyText(commit)}>
                    <Icon icon={Copy} size={14} /> {t('file.tab.copyCommit')}
                </Menu.Item>
            )}
        </>
    );
}
