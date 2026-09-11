import { Menu } from '@base-ui-components/react/menu';
import { Copy, CornerUpRight, FileText, Folder, Globe, ListX, Minus, Pin, PinOff, Plus, RefreshCw, SquareX, X } from 'lucide-react';
import { isHtmlName } from '@/shell/panels/file-kind';
import { localFileUrl } from '@/shell/panels/file-url';
import { basenameOf, relativeTo, revealableInFiles } from '@/shell/panels/files-tree';
import { stageFiles } from '@/shell/panels/stage-files';
import { addNodeAtCenter } from '@/shell/commands';
import { useCanvas } from '@/state/canvas';
import { useFiles } from '@/state/files';
import { useProject } from '@/state/project';
import { fileManagerName, useServer } from '@/state/server';
import { useSettings } from '@/state/settings';
import { transport } from '@/transport';
import { MENU_SEPARATOR } from '@/ui/classes';
import { copyText } from '@/ui/clipboard';
import { Icon } from '@/ui/Icon';

/*
 * Everything an open tab can be asked, as menu items. The toolbar's overflow menu and the right
 * click on a tab offer the same things in the same order, so one list serves both; `ContextMenu`
 * draws `Menu.Item` as its own.
 */
export function FileMenuItems({ tabKey, onRefresh }: { tabKey: string; onRefresh?: () => void }) {
    const tab = useFiles((s) => s.tabs.find((entry) => entry.key === tabKey) ?? null);
    const pinned = tab?.pinned ?? false;
    const hasOthers = useFiles((s) => s.tabs.some((entry) => entry.key !== tabKey));
    const platform = useServer((s) => s.platform);
    const folder = useProject((s) => s.current?.folder ?? null);
    const tabLimit = useSettings((s) => s.filesTabLimit);

    if (tab === null) {
        return null;
    }

    const { path, view } = tab;
    const name = basenameOf(path);
    const commit = view?.commit;
    /* A whole commit is about no file in particular, so the items that act on one say nothing here. */
    const aboutFile = commit === undefined;
    // Staging asks the index a question, which only the diff against the working tree answers.
    const stageable = aboutFile && view !== undefined && view.scope === 'worktree';

    const openInBrowserNode = (): void => {
        const id = addNodeAtCenter('browser');
        useCanvas.getState().updateNode(id, { url: localFileUrl(path) });
    };

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
                        <Menu.Item className="menu-item" onClick={() => useFiles.getState().open(path, tabLimit)}>
                            <Icon icon={FileText} size={14} /> Open the file itself
                        </Menu.Item>
                    )}
                    <Menu.Item className="menu-item" disabled={!revealableInFiles(folder, path)} onClick={() => useFiles.getState().revealInFiles(path)}>
                        <Icon icon={Folder} size={14} /> Reveal in the Files panel
                    </Menu.Item>
                    <Menu.Item
                        className="menu-item"
                        onClick={() => {
                            void transport.request('fs.reveal', { path }).catch(() => undefined);
                        }}
                    >
                        <Icon icon={CornerUpRight} size={14} /> Reveal in {fileManagerName(platform)}
                    </Menu.Item>
                    {view === undefined && isHtmlName(name) && (
                        <Menu.Item className="menu-item" onClick={openInBrowserNode}>
                            <Icon icon={Globe} size={14} /> Open in a browser node
                        </Menu.Item>
                    )}
                    <Menu.Separator className={MENU_SEPARATOR} />
                </>
            )}
            {stageable && (
                <>
                    <Menu.Item className="menu-item" onClick={stage}>
                        <Icon icon={view.staged ? Minus : Plus} size={14} /> {view.staged ? 'Unstage this file' : 'Stage this file'}
                    </Menu.Item>
                    <Menu.Separator className={MENU_SEPARATOR} />
                </>
            )}
            {aboutFile ? (
                <>
                    <Menu.Item className="menu-item" onClick={() => copyText(path)}>
                        <Icon icon={Copy} size={14} /> Copy path
                    </Menu.Item>
                    <Menu.Item className="menu-item" disabled={folder === null} onClick={() => copyText(relativeTo(folder ?? '', path))}>
                        <Icon icon={Copy} size={14} /> Copy relative path
                    </Menu.Item>
                </>
            ) : (
                <Menu.Item className="menu-item" onClick={() => copyText(commit)}>
                    <Icon icon={Copy} size={14} /> Copy commit hash
                </Menu.Item>
            )}
            <Menu.Separator className={MENU_SEPARATOR} />
            {onRefresh !== undefined && (
                <>
                    <Menu.Item className="menu-item" onClick={onRefresh}>
                        <Icon icon={RefreshCw} size={14} /> Refresh
                    </Menu.Item>
                    <Menu.Separator className={MENU_SEPARATOR} />
                </>
            )}
            <Menu.Item className="menu-item" onClick={() => useFiles.getState().setPinned(tabKey, !pinned)}>
                <Icon icon={pinned ? PinOff : Pin} size={14} /> {pinned ? 'Unpin tab' : 'Pin tab'}
            </Menu.Item>
            <Menu.Item className="menu-item" onClick={() => useFiles.getState().close(tabKey)}>
                <Icon icon={X} size={14} /> Close tab <kbd>⌘W</kbd>
            </Menu.Item>
            <Menu.Item className="menu-item" disabled={!hasOthers} onClick={() => useFiles.getState().closeOthers(tabKey)}>
                <Icon icon={ListX} size={14} /> Close other tabs
            </Menu.Item>
            <Menu.Item className="menu-item" onClick={() => useFiles.getState().closeAll()}>
                <Icon icon={SquareX} size={14} /> Close all tabs
            </Menu.Item>
        </>
    );
}
