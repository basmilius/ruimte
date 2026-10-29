import { useTranslation } from 'react-i18next';
import { ignoreRefusal, perform } from '@/actions/client-actions';
import { promoteLooseDatabase } from '@/project/views';
import { Copy, FileText, Minus, PanelLeftOpen, Plus, RefreshCw } from 'lucide-react';
import { useDiffCarets } from '@/shell/panels/diff-caret';
import { FileActionItems } from '@/shell/panels/FileActionItems';
import { relativeTo } from '@/shell/panels/files-tree';
import { stageFiles } from '@/shell/panels/stage-files';
import { isArtifactTab, isCheckoutDiff, isDatabaseTab, isPromotableTab, useFiles } from '@/state/files';
import { copyText, Icon, Menu } from '@adecore/ui';

/*
 * What a loose tab holds can be asked, for the toolbar's overflow menu and the right click on a tab
 * alike; what is about the tab itself is `TabMenuItems`. What is about the file comes from `FileActionItems`.
 */
export function FileMenuItems({ tabKey, onRefresh }: { tabKey: string; onRefresh?: () => void }) {
    const { t } = useTranslation('panels');
    const tab = useFiles((s) => s.tabs.find((entry) => entry.key === tabKey) ?? null);
    const unsubmitted = useFiles((s) => s.unsubmitted[tabKey] === true);
    const caret = useDiffCarets((s) => s.carets[tabKey]);
    if (tab === null || isArtifactTab(tab)) {
        return null;
    }

    // A database view is about no file, so only a table that can stay as a row of the sidebar is left.
    if (isDatabaseTab(tab)) {
        return isPromotableTab(tab) ? (
            <Menu.Item disabled={unsubmitted} onClick={() => void promoteLooseDatabase(tabKey)}>
                <Icon icon={PanelLeftOpen} size={14} /> {t('file.tab.keepInSidebar')}
            </Menu.Item>
        ) : null;
    }

    const { path, view } = tab;
    const commit = view?.commit;
    /* A whole commit or checkout is about no file in particular, so the items that act on one say nothing here. */
    const aboutFile = commit === undefined && !isCheckoutDiff(path, view);
    // Staging asks the index a question, which only the diff against the working tree answers.
    const stageable = aboutFile && view !== undefined && view.scope === 'worktree';

    const stage = (): void => {
        if (view === undefined) {
            return;
        }
        const staged = !view.staged;
        void stageFiles(view.cwd, [relativeTo(view.cwd, path)], staged).then((ok) => {
            if (ok) {
                useFiles.getState().setStaged(tabKey, staged);
            }
        });
    };

    return (
        <>
            {aboutFile && view !== undefined && (
                <Menu.Item onClick={() => void perform('file.preview', { path, line: caret?.line ?? null, column: caret?.column }).catch(ignoreRefusal)}>
                    <Icon icon={FileText} size={14} /> {caret === undefined ? t('file.tab.openItself') : t('file.tab.openItselfAt', { line: caret.line })}
                </Menu.Item>
            )}
            {stageable && (
                <Menu.Item onClick={stage}>
                    <Icon icon={view.staged ? Minus : Plus} size={14} /> {view.staged ? t('file.tab.unstage') : t('file.tab.stage')}
                </Menu.Item>
            )}
            {aboutFile && view !== undefined && <Menu.Separator />}
            {/* A diff tab is about a comparison, so it never offers to refresh the file itself. */}
            {aboutFile && <FileActionItems path={path} on="tab" onRefresh={view === undefined ? onRefresh : undefined} />}
            {commit !== undefined && (
                <Menu.Item onClick={() => copyText(commit)}>
                    <Icon icon={Copy} size={14} /> {t('file.tab.copyCommit')}
                </Menu.Item>
            )}
            {!aboutFile && onRefresh !== undefined && (
                <>
                    {commit !== undefined && <Menu.Separator />}
                    <Menu.Item onClick={onRefresh}>
                        <Icon icon={RefreshCw} size={14} /> {t('file.menu.refresh')}
                    </Menu.Item>
                </>
            )}
        </>
    );
}
