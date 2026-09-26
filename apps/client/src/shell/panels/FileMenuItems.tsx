import { useTranslation } from 'react-i18next';
import { runAsPerson } from '@/actions/client-actions';
import { Menu } from '@base-ui-components/react/menu';
import { Copy, FileText, ListX, Minus, Pin, PinOff, Plus, RefreshCw, SquareX, X } from 'lucide-react';
import { FileActionItems } from '@/shell/panels/FileActionItems';
import { relativeTo } from '@/shell/panels/files-tree';
import { stageFiles } from '@/shell/panels/stage-files';
import { isCheckoutDiff, useFiles } from '@/state/files';
import { MENU_SEPARATOR } from '@ruimte/ui/classes';
import { copyText } from '@ruimte/ui/clipboard';
import { Icon } from '@ruimte/ui/Icon';
import { CANVAS_SHORTCUTS } from '@/canvas/shortcuts';
import { Kbd } from '@ruimte/ui/Kbd';

/*
 * Everything an open tab can be asked, as menu items. The toolbar's overflow menu and the right
 * click on a tab offer the same things in the same order, so one list serves both; `ContextMenu`
 * draws `Menu.Item` as its own. What is about the file rather than the tab comes from
 * `FileActionItems`, which a node and a view of its own show the same way.
 */
export function FileMenuItems({ tabKey, onRefresh }: { tabKey: string; onRefresh?: () => void }) {
    const { t } = useTranslation('panels');
    const tab = useFiles((s) => s.tabs.find((entry) => entry.key === tabKey) ?? null);
    const pinned = tab?.pinned ?? false;
    const hasOthers = useFiles((s) => s.tabs.some((entry) => entry.key !== tabKey));

    if (tab === null) {
        return null;
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
                        <Menu.Item className="menu-item" onClick={() => void runAsPerson('file.preview', { path, line: null })}>
                            <Icon icon={FileText} size={14} /> {t('file.tab.openItself')}
                        </Menu.Item>
                    )}
                    {/* A diff tab is about a comparison, so it never offers to refresh the file itself. */}
                    <FileActionItems path={path} on="tab" onRefresh={view === undefined ? onRefresh : undefined} />
                    <Menu.Separator className={MENU_SEPARATOR} />
                </>
            )}
            {stageable && (
                <>
                    <Menu.Item className="menu-item" onClick={stage}>
                        <Icon icon={view.staged ? Minus : Plus} size={14} /> {view.staged ? t('file.tab.unstage') : t('file.tab.stage')}
                    </Menu.Item>
                    <Menu.Separator className={MENU_SEPARATOR} />
                </>
            )}
            {commit !== undefined && (
                <>
                    <Menu.Item className="menu-item" onClick={() => copyText(commit)}>
                        <Icon icon={Copy} size={14} /> {t('file.tab.copyCommit')}
                    </Menu.Item>
                    <Menu.Separator className={MENU_SEPARATOR} />
                </>
            )}
            {!aboutFile && onRefresh !== undefined && (
                <>
                    <Menu.Item className="menu-item" onClick={onRefresh}>
                        <Icon icon={RefreshCw} size={14} /> {t('file.menu.refresh')}
                    </Menu.Item>
                    <Menu.Separator className={MENU_SEPARATOR} />
                </>
            )}
            <Menu.Item className="menu-item" onClick={() => useFiles.getState().setPinned(tabKey, !pinned)}>
                <Icon icon={pinned ? PinOff : Pin} size={14} /> {pinned ? t('file.tab.unpin') : t('file.tab.pin')}
            </Menu.Item>
            <Menu.Item className="menu-item" onClick={() => useFiles.getState().close(tabKey)}>
                <Icon icon={X} size={14} /> {t('file.tab.close')} <Kbd shortcut={CANVAS_SHORTCUTS.closeCell} />
            </Menu.Item>
            <Menu.Item className="menu-item" disabled={!hasOthers} onClick={() => useFiles.getState().closeOthers(tabKey)}>
                <Icon icon={ListX} size={14} /> {t('file.tab.closeOthers')}
            </Menu.Item>
            <Menu.Item className="menu-item" onClick={() => useFiles.getState().closeAll()}>
                <Icon icon={SquareX} size={14} /> {t('file.tab.closeAll')}
            </Menu.Item>
        </>
    );
}
