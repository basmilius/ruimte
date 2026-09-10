import { Menu } from '@base-ui-components/react/menu';
import { Check, ChevronDown, Frame, Globe, MessageSquare, Minus, Pencil, PenTool, Terminal, Trash } from 'lucide-react';
import { isCanvasView, isOpenableView, type ProjectViewKind } from '@ruimte/contracts';
import { AgentSubmenus } from '@/agents/AgentMenus';
import { addAgentView } from '@/agents/nodes';
import { askDeleteView, askRenameView, newCanvasView, newSeparatorView, newTerminalView, putOnCanvas, showView } from '@/project/views';
import { useDocument } from '@/state/document';
import { useUi } from '@/state/ui';
import { MENU_LABEL, MENU_SEPARATOR } from '@/ui/classes';
import { Icon } from '@/ui/Icon';

const VIEW_ICON: Record<ProjectViewKind, typeof Terminal> = {
    canvas: Frame,
    chat: MessageSquare,
    terminal: Terminal,
    browser: Globe,
    drawing: PenTool,
    separator: Minus
};

/*
 * What "New view" offers: a canvas, or one session with no canvas around it. The agent submenus are
 * the ones the dock uses, so the CLI list can never drift apart between the two.
 */
export function NewViewItems() {
    return (
        <>
            <div className={MENU_LABEL}>New view</div>
            <Menu.Item className="menu-item" onClick={() => newCanvasView()}>
                <Icon icon={Frame} size={14} /> Canvas <kbd>⌘T</kbd>
            </Menu.Item>
            <Menu.Item className="menu-item" onClick={() => void newTerminalView()}>
                <Icon icon={Terminal} size={14} /> Terminal
            </Menu.Item>
            <AgentSubmenus onPick={(target, provider) => void addAgentView(target, provider)} />
            <Menu.Item className="menu-item" onClick={() => useUi.getState().setViewDialog({ kind: 'new-browser' })}>
                <Icon icon={Globe} size={14} /> Browser
            </Menu.Item>
            <Menu.Separator className={MENU_SEPARATOR} />
            <Menu.Item className="menu-item" onClick={() => void newSeparatorView()}>
                <Icon icon={Minus} size={14} /> Separator
            </Menu.Item>
        </>
    );
}

/* The view segment of the toolbar's breadcrumb: every view of this project, and the ways to change the list. */
export function ViewMenu() {
    const views = useDocument((s) => s.views);
    const activeViewId = useDocument((s) => s.activeViewId);
    const active = views.find((view) => view.id === activeViewId);
    if (!active) {
        return null;
    }
    return (
        <Menu.Root>
            <Menu.Trigger className="flex h-8 min-w-0 items-center gap-2 rounded-md px-2 text-left hover:bg-surface-hover data-[popup-open]:bg-surface-active">
                <span className="truncate text-sm text-text">{active.name}</span>
                <Icon icon={ChevronDown} size={14} className="shrink-0 text-text-muted" />
            </Menu.Trigger>
            <Menu.Portal>
                <Menu.Positioner className="z-[var(--z-popup)]" side="bottom" sideOffset={6} align="start">
                    <Menu.Popup className="menu-popup min-w-52">
                        <div className={MENU_LABEL}>Views</div>
                        {views.filter(isOpenableView).map((view, index) => (
                            <Menu.Item key={view.id} className="menu-item" onClick={() => showView(view.id)}>
                                <Icon icon={VIEW_ICON[view.kind]} size={14} />
                                <span className="truncate">{view.name}</span>
                                {view.id === activeViewId && (
                                    <span className="ml-auto flex shrink-0 items-center">
                                        <Icon icon={Check} size={14} />
                                    </span>
                                )}
                                {/* The first nine have a chord of their own; the rest are one click away. */}
                                {index < 9 && view.id !== activeViewId && <kbd>⌘{index + 1}</kbd>}
                            </Menu.Item>
                        ))}
                        <Menu.Separator className={MENU_SEPARATOR} />
                        <NewViewItems />
                        <Menu.Separator className={MENU_SEPARATOR} />
                        {!isCanvasView(active) && (
                            <Menu.Item className="menu-item" onClick={() => putOnCanvas(active.id)}>
                                <Icon icon={Frame} size={14} /> Put on canvas
                            </Menu.Item>
                        )}
                        <Menu.Item className="menu-item" onClick={() => askRenameView(active.id)}>
                            <Icon icon={Pencil} size={14} /> Rename view
                        </Menu.Item>
                        <Menu.Item className="menu-item text-status-error" onClick={() => askDeleteView(active.id)}>
                            <Icon icon={Trash} size={14} /> Delete view
                        </Menu.Item>
                    </Menu.Popup>
                </Menu.Positioner>
            </Menu.Portal>
        </Menu.Root>
    );
}
