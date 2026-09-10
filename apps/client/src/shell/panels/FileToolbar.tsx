import type { ReactNode } from 'react';
import { Menu } from '@base-ui-components/react/menu';
import { Copy, CornerUpRight, Globe, ListX, MoreHorizontal, Pin, PinOff, RefreshCw, WrapText, X, type LucideIcon } from 'lucide-react';
import { useFileActions } from '@/shell/panels/file-actions';
import { isHtmlName } from '@/shell/panels/file-kind';
import { localFileUrl } from '@/shell/panels/file-url';
import { relativeTo } from '@/shell/panels/files-tree';
import { addNodeAtCenter } from '@/shell/commands';
import { useCanvas } from '@/state/canvas';
import { useFiles } from '@/state/files';
import { useProject } from '@/state/project';
import { fileManagerName, useServer } from '@/state/server';
import { transport } from '@/transport';
import { Icon } from '@/ui/Icon';
import { Separator } from '@/ui/Separator';
import { Tooltip } from '@/ui/Tooltip';

/*
 * The bar above every file renderer: the controls that change how the file is drawn, at its right.
 * One component for all three renderers, so a control keeps its place when the open file changes
 * type, and the menu at its end is the same everywhere for the same reason.
 */
export function FileToolbar({ children }: { children?: ReactNode }) {
    return (
        <div className="file-toolbar">
            <span className="grow" />
            {children}
            {/* With no controls the menu is the only group there is, and a line would divide nothing. */}
            {children !== undefined && <Separator />}
            <FileMenu />
        </div>
    );
}

interface FileToolbarToggleProps {
    icon: LucideIcon;
    /* Also the button's accessible name, since the glyph carries no words of its own. */
    label: string;
    active: boolean;
    /* `aria-disabled` rather than `disabled`: a disabled button swallows the pointer, and with it the
       tooltip that says why the control cannot be used right now. */
    disabled?: boolean;
    onClick: () => void;
}

/* One control in the bar. `aria-pressed` is both the state a screen reader reads and what draws the
   pressed gray key, the same style `data-active` gets in `styles.css`. */
export function FileToolbarToggle({ icon, label, active, disabled = false, onClick }: FileToolbarToggleProps) {
    return (
        <Tooltip label={label} name>
            <button
                className="icon-btn h-7 w-7 aria-disabled:cursor-default aria-disabled:opacity-40 aria-disabled:hover:bg-transparent"
                aria-pressed={active}
                aria-disabled={disabled}
                onClick={() => {
                    if (!disabled) {
                        onClick();
                    }
                }}
            >
                <Icon icon={icon} size={14} />
            </button>
        </Tooltip>
    );
}

/* The code view's wrap control as every other view draws it: there, so the switch beside it keeps its
   place, and inert, because there are no lines of source to wrap. */
export function DisabledWrapToggle() {
    return <FileToolbarToggle icon={WrapText} label="Wrap long lines (source view only)" active={false} disabled onClick={() => undefined} />;
}

const copyText = (text: string): void => {
    void navigator.clipboard.writeText(text).catch(() => undefined);
};

/*
 * Everything the open file can be asked, in one menu at the end of the bar: what the Files panel
 * offers a row (reveal, copy a path), what the tab strip offers a tab, and a fresh read. The file
 * comes from the viewer through `useFileActions`, so no renderer has to hand it over.
 */
function FileMenu() {
    const actions = useFileActions();
    const platform = useServer((s) => s.platform);
    const folder = useProject((s) => s.current?.folder ?? null);
    const pinned = useFiles((s) => s.tabs.some((tab) => tab.path === actions?.path && tab.pinned));
    const hasOthers = useFiles((s) => s.tabs.some((tab) => tab.path !== actions?.path));

    if (!actions) {
        return null;
    }

    const { path, name, refresh } = actions;

    const openInBrowserNode = (): void => {
        const id = addNodeAtCenter('browser');
        useCanvas.getState().updateNode(id, { url: localFileUrl(path) });
    };

    const closeOthers = (): void => {
        const files = useFiles.getState();
        // A pinned tab goes with the rest: the person asked for this file and nothing else.
        for (const tab of files.tabs) {
            if (tab.path !== path) {
                files.close(tab.path);
            }
        }
    };

    return (
        <Menu.Root>
            <Tooltip label="More" name>
                <Menu.Trigger className="icon-btn h-7 w-7">
                    <Icon icon={MoreHorizontal} size={14} />
                </Menu.Trigger>
            </Tooltip>
            <Menu.Portal>
                <Menu.Positioner className="popup-layer" side="bottom" align="end" sideOffset={6}>
                    <Menu.Popup className="menu-popup">
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
                        <Menu.Separator className="menu-separator" />
                        <Menu.Item className="menu-item" onClick={() => copyText(path)}>
                            <Icon icon={Copy} size={14} /> Copy path
                        </Menu.Item>
                        <Menu.Item className="menu-item" disabled={folder === null} onClick={() => copyText(relativeTo(folder ?? '', path))}>
                            <Icon icon={Copy} size={14} /> Copy relative path
                        </Menu.Item>
                        <Menu.Separator className="menu-separator" />
                        <Menu.Item className="menu-item" onClick={refresh}>
                            <Icon icon={RefreshCw} size={14} /> Refresh
                        </Menu.Item>
                        <Menu.Separator className="menu-separator" />
                        <Menu.Item className="menu-item" onClick={() => useFiles.getState().setPinned(path, !pinned)}>
                            <Icon icon={pinned ? PinOff : Pin} size={14} /> {pinned ? 'Unpin tab' : 'Pin tab'}
                        </Menu.Item>
                        <Menu.Item className="menu-item" onClick={() => useFiles.getState().close(path)}>
                            <Icon icon={X} size={14} /> Close tab <kbd>⌘W</kbd>
                        </Menu.Item>
                        <Menu.Item className="menu-item" disabled={!hasOthers} onClick={closeOthers}>
                            <Icon icon={ListX} size={14} /> Close other tabs
                        </Menu.Item>
                    </Menu.Popup>
                </Menu.Positioner>
            </Menu.Portal>
        </Menu.Root>
    );
}
