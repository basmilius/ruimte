import { useMemo } from 'react';
import { Menu } from '@base-ui-components/react/menu';
import { Check, ChevronDown, FileText, Frame, Globe, Minus, PanelBottom, PanelRight, Pencil, PenTool, Workflow, Smile, Terminal, Trash, X } from 'lucide-react';
import { isDiagramView, isDrawingView, isFileView, isOpenableView, isSessionView, viewIconOf } from '@ruimte/contracts';
import { AgentIcon } from '@/agents/AgentIcon';
import { AgentSubmenus } from '@/agents/AgentMenus';
import { addAgentView } from '@/agents/nodes';
import {
    askDeleteView,
    askRenameView,
    askViewIcon,
    newCanvasView,
    newDiagramView,
    newDrawingView,
    newSeparatorView,
    freeViewFor,
    newTerminalView,
    putOnCanvas,
    splitFocusedCell,
    showView,
    showViewOnCanvas
} from '@/project/views';
import { ViewGlyph } from '@/project/ViewGlyph';
import { canSplit, cellCount, type SplitDirection } from '@/shell/split';
import { useDocument } from '@/state/document';
import { useProject } from '@/state/project';
import { useProviders } from '@/state/providers';
import { Tile } from '@/ui/Tile';
import { useUi } from '@/state/ui';
import { MENU_LABEL, MENU_SEPARATOR } from '@/ui/classes';
import { Icon } from '@/ui/Icon';
import { CANVAS_SHORTCUTS, viewShortcut } from '@/canvas/shortcuts';
import { Kbd } from '@/ui/Kbd';

/*
 * The same choices as tiles, for a project without any view: an empty sidebar with nothing to click
 * reads as broken. A separator is left out, since a line between no rows separates nothing.
 */
export function NewViewTiles() {
    const hasFolder = useProject((s) => s.current?.folder != null);
    const providers = useProviders((s) => s.providers);
    const agents = useMemo(() => providers.filter((provider) => provider.installed && provider.capabilities.chat), [providers]);
    return (
        <div className="grid grid-cols-2 gap-1.5">
            <Tile size="sm" icon={<Icon icon={Frame} size={14} />} title="Canvas" onClick={() => newCanvasView()} />
            <Tile size="sm" icon={<Icon icon={PenTool} size={14} />} title="Drawing" onClick={() => void newDrawingView()} />
            <Tile size="sm" icon={<Icon icon={Workflow} size={14} />} title="Diagram" onClick={() => void newDiagramView()} />
            <Tile size="sm" icon={<Icon icon={Terminal} size={14} />} title="Terminal" onClick={() => void newTerminalView()} />
            {agents.map((provider) => (
                <Tile
                    key={provider.kind}
                    size="sm"
                    icon={<AgentIcon kind={provider.kind} size={14} />}
                    title={provider.name}
                    onClick={() => void addAgentView('chat', provider)}
                />
            ))}
            <Tile size="sm" icon={<Icon icon={Globe} size={14} />} title="Browser" onClick={() => useUi.getState().setViewDialog({ kind: 'new-browser' })} />
            {hasFolder && (
                <Tile size="sm" icon={<Icon icon={FileText} size={14} />} title="File" onClick={() => useUi.getState().openFilePicker({ kind: 'view' })} />
            )}
        </div>
    );
}

/*
 * What "New view" offers: a canvas, or one session with no canvas around it. The agent submenus are
 * the ones the dock uses, so the CLI list can never drift apart between the two.
 */
export function NewViewItems() {
    /* A file comes out of the open folder, so a project without one has nothing to pick from. */
    const hasFolder = useProject((s) => s.current?.folder != null);
    return (
        <>
            <Menu.Item className="menu-item" onClick={() => newCanvasView()}>
                <Icon icon={Frame} size={14} /> Canvas <Kbd shortcut={CANVAS_SHORTCUTS.newView} />
            </Menu.Item>
            <Menu.Item className="menu-item" onClick={() => void newDrawingView()}>
                <Icon icon={PenTool} size={14} /> Drawing
            </Menu.Item>
            <Menu.Item className="menu-item" onClick={() => void newDiagramView()}>
                <Icon icon={Workflow} size={14} /> Diagram
            </Menu.Item>
            <Menu.Item className="menu-item" onClick={() => void newTerminalView()}>
                <Icon icon={Terminal} size={14} /> Terminal
            </Menu.Item>
            <AgentSubmenus onPick={(target, provider) => void addAgentView(target, provider)} />
            <Menu.Item className="menu-item" onClick={() => useUi.getState().setViewDialog({ kind: 'new-browser' })}>
                <Icon icon={Globe} size={14} /> Browser
            </Menu.Item>
            {hasFolder && (
                <Menu.Item className="menu-item" onClick={() => useUi.getState().openFilePicker({ kind: 'view' })}>
                    <Icon icon={FileText} size={14} /> File...
                </Menu.Item>
            )}
            <Menu.Separator className={MENU_SEPARATOR} />
            <Menu.Item className="menu-item" onClick={() => void newSeparatorView()}>
                <Icon icon={Minus} size={14} /> Separator
            </Menu.Item>
        </>
    );
}

/*
 * Putting a view beside the one on screen. Which view lands there is the same question the shortcut
 * answers (`freeViewFor`): the first one that is not standing anywhere yet, since a view is in at
 * most one cell. With every view already up, or with the grid full, the row is not offered.
 */
function SplitItems() {
    const layout = useDocument((s) => s.layout);
    const free = useDocument(freeViewFor);
    const closable = layout !== null && cellCount(layout) > 1;
    const room = (direction: SplitDirection): boolean => layout !== null && free !== null && canSplit(layout, layout.focus, direction, free);
    if (!room('right') && !room('down') && !closable) {
        return null;
    }
    return (
        <>
            {room('right') && (
                <Menu.Item className="menu-item" onClick={() => splitFocusedCell('right')}>
                    <Icon icon={PanelRight} size={14} /> Split to the right <Kbd shortcut={CANVAS_SHORTCUTS.splitRight} />
                </Menu.Item>
            )}
            {room('down') && (
                <Menu.Item className="menu-item" onClick={() => splitFocusedCell('down')}>
                    <Icon icon={PanelBottom} size={14} /> Split downwards <Kbd shortcut={CANVAS_SHORTCUTS.splitDown} />
                </Menu.Item>
            )}
            {closable && (
                <Menu.Item className="menu-item" onClick={() => useDocument.getState().closeCellAt(layout.focus)}>
                    <Icon icon={X} size={14} /> Close this cell <Kbd shortcut={CANVAS_SHORTCUTS.closeCell} />
                </Menu.Item>
            )}
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
                <ViewGlyph
                    id={active.id}
                    kind={active.kind}
                    icon={viewIconOf(active)}
                    provider={active.kind === 'chat' || active.kind === 'terminal' ? active.node.provider : null}
                    path={active.kind === 'file' ? active.path : null}
                />
                <span className="truncate text-sm text-text">{active.name}</span>
                <Icon icon={ChevronDown} size={14} className="shrink-0 text-text-muted" />
            </Menu.Trigger>
            <Menu.Portal>
                <Menu.Positioner className="z-(--z-popup)" side="bottom" sideOffset={6} align="start">
                    <Menu.Popup className="menu-popup min-w-52">
                        <div className={MENU_LABEL}>Views</div>
                        {views.filter(isOpenableView).map((view, index) => (
                            <Menu.Item key={view.id} className="menu-item" onClick={() => showView(view.id)}>
                                <ViewGlyph
                                    id={view.id}
                                    kind={view.kind}
                                    icon={viewIconOf(view)}
                                    provider={view.kind === 'chat' || view.kind === 'terminal' ? view.node.provider : null}
                                    path={view.kind === 'file' ? view.path : null}
                                />
                                <span className="truncate">{view.name}</span>
                                {view.id === activeViewId && (
                                    <span className="ml-auto flex shrink-0 items-center">
                                        <Icon icon={Check} size={14} />
                                    </span>
                                )}
                                {/* The first nine have a shortcut of their own; the rest are one click away. */}
                                {index < 9 && view.id !== activeViewId && <Kbd shortcut={viewShortcut(index)!} />}
                            </Menu.Item>
                        ))}
                        <Menu.Separator className={MENU_SEPARATOR} />
                        {/* Here the items follow the list of views, so they say what they are; under
                            the button called "New view" they would repeat it. */}
                        <div className={MENU_LABEL}>New view</div>
                        <NewViewItems />
                        <Menu.Separator className={MENU_SEPARATOR} />
                        <SplitItems />
                        <Menu.Separator className={MENU_SEPARATOR} />
                        {isSessionView(active) && (
                            <Menu.Item className="menu-item" onClick={() => putOnCanvas(active.id)}>
                                <Icon icon={Frame} size={14} /> Put on canvas
                            </Menu.Item>
                        )}
                        {(isDrawingView(active) || isDiagramView(active) || isFileView(active)) && (
                            <Menu.Item className="menu-item" onClick={() => showViewOnCanvas(active.id)}>
                                <Icon icon={Frame} size={14} /> Show on the canvas
                            </Menu.Item>
                        )}
                        <Menu.Item className="menu-item" onClick={() => askRenameView(active.id)}>
                            <Icon icon={Pencil} size={14} /> Rename view
                        </Menu.Item>
                        <Menu.Item className="menu-item" onClick={() => askViewIcon(active.id)}>
                            <Icon icon={Smile} size={14} /> Change icon…
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
