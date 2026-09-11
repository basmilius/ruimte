import { Fragment, useEffect, useRef, useState } from 'react';
import { ContextMenu } from '@base-ui-components/react/context-menu';
import { buildBrowserMenu, type BrowserMenuAction, type BrowserMenuItem } from '@/browser/browser-menu';
import { menuPointFor } from '@/browser/menu-point';
import { openLinkBeside } from '@/browser/open-beside';
import { browserRegistry, useBrowser } from '@/browser/registry';
import { desktop, type BrowserContextAction } from '@/desktop/bridge';
import { MENU_SEPARATOR } from '@/ui/classes';
import { copyText } from '@/ui/clipboard';
import { Icon } from '@/ui/Icon';

/* The guest the menu that is open belongs to, and where in its page the click landed. */
interface MenuTarget {
    webContentsId: number;
    /* The page's node, keyed on the machine its project is on (`state/keys.ts`). */
    key: string;
    guest: { x: number; y: number };
}

/* Flip while working on the mapping itself; a build logs nothing. */
const DEBUG: boolean = false;

/*
 * The menu behind a right-click inside a browser page, drawn in the app's own style. Electron ships
 * none for web content, and a native one would read as another program's; the shell only says what
 * the click landed on and carries out the rows that reach into the guest, the downloads or the
 * system. An editable field is the shell's own, native, and never arrives here. One of these is
 * mounted for every page there is, because a page is never the React tree the click came from.
 */
export function BrowserContextMenu() {
    const [groups, setGroups] = useState<BrowserMenuItem[][] | null>(null);
    const target = useRef<MenuTarget | null>(null);
    const at = useRef<{ x: number; y: number } | null>(null);
    const trigger = useRef<HTMLDivElement>(null);

    useEffect(
        () =>
            desktop()?.onBrowserContextMenu?.((params) => {
                const key = browserRegistry.keyOfContents(params.webContentsId);
                const element = key === null ? undefined : browserRegistry.get(key);
                if (key === null || !element) {
                    return;
                }
                const state = useBrowser.getState().byKey[key];
                const rect = element.getBoundingClientRect();
                // The camera's zoom, read back from what the host was drawn at.
                const zoom = element.offsetWidth > 0 ? rect.width / element.offsetWidth : 1;
                const point = menuPointFor(params, rect, zoom);
                if (DEBUG) {
                    console.debug(
                        `[browser-menu] click ${params.x},${params.y} host ${rect.left},${rect.top} zoom ${zoom} page ${point.guest.x},${point.guest.y}`
                    );
                }
                const built = buildBrowserMenu({ ...params, canGoBack: state?.canGoBack ?? false, canGoForward: state?.canGoForward ?? false });
                if (built.length === 0) {
                    return;
                }
                target.current = { webContentsId: params.webContentsId, key, guest: point.guest };
                at.current = point.window;
                setGroups(built);
            }),
        []
    );

    // Base UI anchors a context menu to the pointer of the event that opened it, and this one
    // happened inside a page, where the window never saw it. Handing the trigger that same event at
    // the mapped point is what puts the popup under the cursor.
    useEffect(() => {
        const point = at.current;
        if (groups === null || point === null) {
            return;
        }
        at.current = null;
        trigger.current?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: point.x, clientY: point.y }));
    }, [groups]);

    const run = (action: BrowserMenuAction): void => {
        const current = target.current;
        if (current === null) {
            return;
        }
        const ask = (name: BrowserContextAction['action'], payload?: BrowserContextAction['payload']): void => {
            desktop()?.browserContextAction?.({ webContentsId: current.webContentsId, action: name, payload });
        };
        switch (action.kind) {
            // The registry owns the page, so its own history and its error banner stay in one place.
            case 'back':
                browserRegistry.back(current.key);
                return;
            case 'forward':
                browserRegistry.forward(current.key);
                return;
            case 'reload':
                browserRegistry.reload(current.key, false);
                return;
            case 'open-beside':
                openLinkBeside(action.url, current.webContentsId);
                return;
            case 'copy-text':
                copyText(action.text);
                return;
            case 'open-external':
                ask('open-external', { url: action.url });
                return;
            // The guest's own copy, which keeps what a plain string would lose.
            case 'copy-selection':
                ask('copy');
                return;
            case 'copy-image':
                ask('copy-image', current.guest);
                return;
            case 'save-image':
                ask('save-image', { url: action.url });
                return;
            case 'inspect':
                ask('inspect', current.guest);
                return;
        }
    };

    return (
        <ContextMenu.Root>
            <ContextMenu.Trigger ref={trigger} className="fixed top-0 left-0 h-0 w-0" aria-hidden />
            {groups !== null && (
                <ContextMenu.Portal>
                    <ContextMenu.Positioner className="z-[var(--z-popup)]">
                        <ContextMenu.Popup className="menu-popup">
                            {groups.map((group, index) => (
                                <Fragment key={group[0]?.id ?? index}>
                                    {index > 0 && <ContextMenu.Separator className={MENU_SEPARATOR} />}
                                    {group.map((item) => (
                                        <ContextMenu.Item key={item.id} className="menu-item" disabled={item.disabled} onClick={() => run(item.action)}>
                                            <Icon icon={item.icon} size={14} /> {item.label}
                                        </ContextMenu.Item>
                                    ))}
                                </Fragment>
                            ))}
                        </ContextMenu.Popup>
                    </ContextMenu.Positioner>
                </ContextMenu.Portal>
            )}
        </ContextMenu.Root>
    );
}
