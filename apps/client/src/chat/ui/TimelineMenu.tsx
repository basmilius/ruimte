import type { RefObject } from 'react';
import { ContextMenu } from '@base-ui-components/react/context-menu';
import { Braces, Copy, Eye, FileText, MessageSquare, Scan } from 'lucide-react';
import { markdownOf, messageTextOf } from '@/chat/logic/timeline-copy';
import type { TimelineTarget } from '@/chat/logic/timeline-target';
import { absoluteOf } from '@/shell/panels/files-tree';
import { useFiles } from '@/state/files';
import { useProject } from '@/state/project';
import { useSettings } from '@/state/settings';
import { MENU_SEPARATOR } from '@/ui/classes';
import { copyText } from '@/ui/clipboard';
import { Icon } from '@/ui/Icon';
import { selectAllWithin } from '@/ui/selection';

/*
 * The menu behind a right-click in a thread. Copy is the reason it exists: everything in a thread
 * is text a person may want out of it, and a whole message, a code block or the markdown an answer
 * was written in are each a different amount of that.
 */
export function TimelineMenuPopup({ target, scroller }: { target: TimelineTarget; scroller: RefObject<HTMLDivElement | null> }) {
    const message = target.row === null ? null : messageTextOf(target.row);
    const markdown = target.row === null ? null : markdownOf(target.row);
    const openInPreview = (): void => {
        const folder = useProject.getState().current?.folder ?? null;
        if (target.path === null || folder === null) {
            return;
        }
        useFiles.getState().open(absoluteOf(folder, target.path), useSettings.getState().filesTabLimit);
    };
    return (
        <ContextMenu.Portal>
            <ContextMenu.Positioner className="z-[var(--z-popup)]">
                <ContextMenu.Popup className="menu-popup">
                    <ContextMenu.Item className="menu-item" disabled={target.selection === ''} onClick={() => copyText(target.selection)}>
                        <Icon icon={Copy} size={14} /> Copy <kbd>⌘C</kbd>
                    </ContextMenu.Item>
                    {message !== null && (
                        <ContextMenu.Item className="menu-item" onClick={() => copyText(message)}>
                            <Icon icon={MessageSquare} size={14} /> Copy message
                        </ContextMenu.Item>
                    )}
                    {target.code !== null && (
                        <ContextMenu.Item className="menu-item" onClick={() => copyText(target.code ?? '')}>
                            <Icon icon={Braces} size={14} /> Copy code
                        </ContextMenu.Item>
                    )}
                    {markdown !== null && (
                        <ContextMenu.Item className="menu-item" onClick={() => copyText(markdown)}>
                            <Icon icon={FileText} size={14} /> Copy as markdown
                        </ContextMenu.Item>
                    )}
                    <ContextMenu.Separator className={MENU_SEPARATOR} />
                    <ContextMenu.Item className="menu-item" onClick={() => selectAllWithin(scroller.current)}>
                        <Icon icon={Scan} size={14} /> Select all
                    </ContextMenu.Item>
                    {target.path !== null && (
                        <>
                            <ContextMenu.Separator className={MENU_SEPARATOR} />
                            <ContextMenu.Item className="menu-item" onClick={openInPreview}>
                                <Icon icon={Eye} size={14} /> Open in preview
                            </ContextMenu.Item>
                        </>
                    )}
                </ContextMenu.Popup>
            </ContextMenu.Positioner>
        </ContextMenu.Portal>
    );
}
