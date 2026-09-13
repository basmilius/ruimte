import { Menu } from '@base-ui-components/react/menu';
import { Columns2, Copy, CornerUpRight, Folder, Frame, Globe, RefreshCw } from 'lucide-react';
import { newFileView, showFileOnCanvas } from '@/project/views';
import { isHtmlName } from '@/shell/panels/file-kind';
import { localFileUrl } from '@/shell/panels/file-url';
import { basenameOf, relativeTo, revealableInFiles } from '@/shell/panels/files-tree';
import { addNodeAtCenter } from '@/shell/commands';
import { focusedCanvas } from '@/state/canvas';
import { useFiles } from '@/state/files';
import { useProject } from '@/state/project';
import { fileManagerName, useServer } from '@/state/server';
import { useTransport } from '@/transport/context';
import { MENU_SEPARATOR } from '@/ui/classes';
import { copyText } from '@/ui/clipboard';
import { Icon } from '@/ui/Icon';

/* Which of the three surfaces these items are on, since a file already on one does not offer to go
   there again: a node is not shown on the canvas twice and a view is not opened as one. */
export type FileSurfaceKind = 'tab' | 'node' | 'view';

interface FileActionItemsProps {
    /* Absolute on the daemon's machine. */
    path: string;
    on: FileSurfaceKind;
    /* Reads the file again; absent where nothing is holding a read to redo. */
    onRefresh?: () => void;
}

/*
 * What can be asked of a file wherever it is drawn: a preview tab, a node on the canvas or a view
 * of its own. Nothing here is about a tab, so the three surfaces offer the same things in the same
 * order and only the two that would point at themselves are left out.
 */
export function FileActionItems({ path, on, onRefresh }: FileActionItemsProps) {
    const platform = useServer((s) => s.platform);
    const folder = useProject((s) => s.current?.folder ?? null);
    const transport = useTransport();
    const name = basenameOf(path);

    const openInBrowserNode = (): void => {
        const id = addNodeAtCenter('browser');
        if (id !== null) {
            focusedCanvas()
                .getState()
                .updateNode(id, { url: localFileUrl(path) });
        }
    };

    return (
        <>
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
            {isHtmlName(name) && (
                <Menu.Item className="menu-item" onClick={openInBrowserNode}>
                    <Icon icon={Globe} size={14} /> Open in a browser node
                </Menu.Item>
            )}
            <Menu.Separator className={MENU_SEPARATOR} />
            {on !== 'node' && (
                <Menu.Item className="menu-item" onClick={() => showFileOnCanvas(path)}>
                    <Icon icon={Frame} size={14} /> Show on the canvas
                </Menu.Item>
            )}
            {on !== 'view' && (
                <Menu.Item className="menu-item" onClick={() => newFileView(path)}>
                    <Icon icon={Columns2} size={14} /> Open as a view
                </Menu.Item>
            )}
            <Menu.Separator className={MENU_SEPARATOR} />
            <Menu.Item className="menu-item" onClick={() => copyText(path)}>
                <Icon icon={Copy} size={14} /> Copy path
            </Menu.Item>
            <Menu.Item className="menu-item" disabled={folder === null} onClick={() => copyText(relativeTo(folder ?? '', path))}>
                <Icon icon={Copy} size={14} /> Copy relative path
            </Menu.Item>
            {onRefresh !== undefined && (
                <>
                    <Menu.Separator className={MENU_SEPARATOR} />
                    <Menu.Item className="menu-item" onClick={onRefresh}>
                        <Icon icon={RefreshCw} size={14} /> Refresh
                    </Menu.Item>
                </>
            )}
        </>
    );
}
