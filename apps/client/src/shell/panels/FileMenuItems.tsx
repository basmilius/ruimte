import { useTranslation } from 'react-i18next';
import { runAsPerson } from '@/actions/client-actions';
import { promoteLooseDatabase } from '@/project/views';
import { Copy, FileText, ListX, Minus, PanelLeftOpen, Pin, PinOff, Plus, RefreshCw, SquareX, X } from 'lucide-react';
import { FileActionItems } from '@/shell/panels/FileActionItems';
import { relativeTo } from '@/shell/panels/files-tree';
import { stageFiles } from '@/shell/panels/stage-files';
import { cellAt, cellViewIds, locateView } from '@/shell/split';
import { useDocument } from '@/state/document';
import { isCheckoutDiff, isDatabaseTab, isPromotableTab, useFiles } from '@/state/files';
import { copyText, Icon, Kbd, Menu } from '@adecore/ui';
import { CANVAS_SHORTCUTS } from '@/canvas/shortcuts';

/*
 * Everything an open tab can be asked, for the toolbar's overflow menu and the right click on a tab
 * alike; `ContextMenu` draws `Menu.Item` as its own. What is about the file comes from `FileActionItems`.
 */
export function FileMenuItems({ tabKey, onRefresh }: { tabKey: string; onRefresh?: () => void }) {
    const { t } = useTranslation('panels');
    const tab = useFiles((s) => s.tabs.find((entry) => entry.key === tabKey) ?? null);
    const pinned = tab?.pinned ?? false;
    const unsubmitted = useFiles((s) => s.unsubmitted[tabKey] === true);
    const hasOthers = useDocument((s) => {
        const at = s.layout === null ? null : locateView(s.layout, tabKey);
        const cell = s.layout === null || at === null ? null : cellAt(s.layout, at);
        return cell !== null && cellViewIds(cell).some((id) => id !== tabKey && !s.views.some((view) => view.id === id));
    });

    if (tab === null) {
        return null;
    }

    const tabItems = (
        <>
            <Menu.Item onClick={() => useFiles.getState().setPinned(tabKey, !pinned)}>
                <Icon icon={pinned ? PinOff : Pin} size={14} /> {pinned ? t('file.tab.unpin') : t('file.tab.pin')}
            </Menu.Item>
            <Menu.Item onClick={() => useFiles.getState().close(tabKey)}>
                <Icon icon={X} size={14} /> {t('file.tab.close')} <Kbd shortcut={CANVAS_SHORTCUTS.closeCell} />
            </Menu.Item>
            <Menu.Item disabled={!hasOthers} onClick={() => useFiles.getState().closeOthers(tabKey)}>
                <Icon icon={ListX} size={14} /> {t('file.tab.closeOthers')}
            </Menu.Item>
            <Menu.Item onClick={() => useFiles.getState().closeAll(tabKey)}>
                <Icon icon={SquareX} size={14} /> {t('file.tab.closeAll')}
            </Menu.Item>
        </>
    );
    // A database view is about no file, so only what is about the tab is left, and a table that can stay as a row of the sidebar.
    if (isDatabaseTab(tab)) {
        return (
            <>
                {isPromotableTab(tab) && (
                    <>
                        <Menu.Item disabled={unsubmitted} onClick={() => void promoteLooseDatabase(tabKey)}>
                            <Icon icon={PanelLeftOpen} size={14} /> {t('file.tab.keepInSidebar')}
                        </Menu.Item>
                        <Menu.Separator />
                    </>
                )}
                {tabItems}
            </>
        );
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
            {aboutFile && (
                <>
                    {view !== undefined && (
                        <Menu.Item onClick={() => void runAsPerson('file.preview', { path, line: null })}>
                            <Icon icon={FileText} size={14} /> {t('file.tab.openItself')}
                        </Menu.Item>
                    )}
                    {/* A diff tab is about a comparison, so it never offers to refresh the file itself. */}
                    <FileActionItems path={path} on="tab" onRefresh={view === undefined ? onRefresh : undefined} />
                    <Menu.Separator />
                </>
            )}
            {stageable && (
                <>
                    <Menu.Item onClick={stage}>
                        <Icon icon={view.staged ? Minus : Plus} size={14} /> {view.staged ? t('file.tab.unstage') : t('file.tab.stage')}
                    </Menu.Item>
                    <Menu.Separator />
                </>
            )}
            {commit !== undefined && (
                <>
                    <Menu.Item onClick={() => copyText(commit)}>
                        <Icon icon={Copy} size={14} /> {t('file.tab.copyCommit')}
                    </Menu.Item>
                    <Menu.Separator />
                </>
            )}
            {!aboutFile && onRefresh !== undefined && (
                <>
                    <Menu.Item onClick={onRefresh}>
                        <Icon icon={RefreshCw} size={14} /> {t('file.menu.refresh')}
                    </Menu.Item>
                    <Menu.Separator />
                </>
            )}
            {tabItems}
        </>
    );
}
