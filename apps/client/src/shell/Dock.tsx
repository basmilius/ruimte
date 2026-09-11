import { Menu } from '@base-ui-components/react/menu';
import {
    Check,
    Globe,
    LayoutGrid,
    LayoutTemplate,
    Lock,
    LockOpen,
    Maximize,
    MessageSquare,
    Minus,
    Plus,
    Save,
    Scan,
    StickyNote,
    Terminal,
    Type,
    X
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { isCanvasView } from '@ruimte/contracts';
import { AgentSubmenus } from '@/agents/AgentMenus';
import { addAgentNode } from '@/agents/nodes';
import { activeZoomPreset, toWorld, ZOOM_PRESETS } from '@/canvas/math';
import { LOCK_ROWS } from '@/canvas/locks';
import { useCanvas, type NodeKind } from '@/state/canvas';
import { activeViewOf, useDocument } from '@/state/document';
import { useUi } from '@/state/ui';
import { ModeChip } from '@/shell/ModeChip';
import { StatusSummary } from '@/shell/StatusSummary';
import { BTN_GROUP, MENU_HINT, MENU_LABEL, MENU_SEPARATOR } from '@/ui/classes';
import { DockShell } from '@/ui/DockShell';
import { Tooltip } from '@/ui/Tooltip';
import { Icon } from '@/ui/Icon';
import { Separator } from '@/ui/Separator';

const centerWorld = () => {
    const s = useCanvas.getState();
    return toWorld(s.camera, { x: s.viewport.w / 2, y: s.viewport.h / 2 });
};

/*
 * The canvas's own controls: zoom, locks, layouts and the plus that adds a node. A view of its own
 * has no canvas under it, so the dock stays away there; its counters are the sidebar's "Needs you"
 * section, and the way out of a body is Escape, the chord a terminal uses, or its row in the list.
 */
export function Dock() {
    const page = useUi((s) => s.page);
    /* No view at all is no canvas either: with no project open the column holds the empty state and
       these controls would act on a canvas nothing saves. */
    const onCanvas = useDocument((s) => {
        const view = activeViewOf(s);
        return view !== null && isCanvasView(view);
    });
    const { zoom, locks, hasSelection, layouts } = useCanvas(
        useShallow((s) => ({
            zoom: s.camera.zoom,
            locks: s.locks,
            hasSelection: s.selection.length > 0,
            layouts: s.layouts
        }))
    );
    const anyLocked = Object.values(locks).some(Boolean);
    const allLocked = Object.values(locks).every(Boolean);
    const zoomPct = Math.round(zoom * 100);
    const preset = activeZoomPreset(zoom);

    const add = (kind: NodeKind) => {
        useCanvas.getState().addNode(kind, centerWorld());
    };

    // A page fills the column: the canvas under it is inert and its controls have nothing to act on.
    if (!onCanvas || page !== null) {
        return null;
    }
    return (
        <DockShell>
            <ModeChip />
            <Separator />
            <StatusSummary />

            <Menu.Root>
                <Tooltip label="Add" name>
                    <Menu.Trigger className="icon-btn">
                        <Icon icon={Plus} size={16} />
                    </Menu.Trigger>
                </Tooltip>
                <Menu.Portal>
                    <Menu.Positioner className="z-[var(--z-popup)]" side="top" sideOffset={10} align="start">
                        <Menu.Popup className="menu-popup">
                            <Menu.Item className="menu-item" onClick={() => add('terminal')}>
                                <Icon icon={Terminal} size={14} /> Terminal <kbd>⌥T</kbd>
                            </Menu.Item>
                            <Menu.Item className="menu-item" onClick={() => add('chat')}>
                                <Icon icon={MessageSquare} size={14} /> Chat <kbd>⌥C</kbd>
                            </Menu.Item>
                            <AgentSubmenus onPick={(target, provider) => addAgentNode(target, provider, centerWorld())} />
                            <Menu.Item className="menu-item" onClick={() => add('browser')}>
                                <Icon icon={Globe} size={14} /> Browser <kbd>⌥B</kbd>
                            </Menu.Item>
                            <Menu.Item className="menu-item" onClick={() => add('group')}>
                                <Icon icon={LayoutGrid} size={14} /> Group <kbd>⌥G</kbd>
                            </Menu.Item>
                            <Menu.Item className="menu-item" onClick={() => add('note')}>
                                <Icon icon={StickyNote} size={14} /> Note <kbd>⌥N</kbd>
                            </Menu.Item>
                            <Menu.Separator className={MENU_SEPARATOR} />
                            <Menu.Item className="menu-item" onClick={() => useCanvas.getState().addText(centerWorld())}>
                                <Icon icon={Type} size={14} /> Text <span className={MENU_HINT}>dbl-click</span>
                            </Menu.Item>
                        </Menu.Popup>
                    </Menu.Positioner>
                </Menu.Portal>
            </Menu.Root>

            <Separator />
            <div className={BTN_GROUP}>
                <Tooltip label="Zoom out" name>
                    <button className="icon-btn" onClick={() => useCanvas.getState().zoomTo(Math.round(zoom * 100 - 10) / 100)}>
                        <Icon icon={Minus} size={16} />
                    </button>
                </Tooltip>
                <Menu.Root>
                    <Tooltip label="Zoom presets">
                        <Menu.Trigger className="h-8 min-w-14 rounded-lg px-1 text-xs tabular-nums text-text-muted hover:bg-surface-hover hover:text-text data-[popup-open]:bg-surface-active data-[popup-open]:text-text">
                            {zoomPct}%
                        </Menu.Trigger>
                    </Tooltip>
                    <Menu.Portal>
                        <Menu.Positioner className="z-[var(--z-popup)]" side="top" sideOffset={10} align="center">
                            <Menu.Popup className="menu-popup min-w-44">
                                <Menu.RadioGroup value={preset} onValueChange={(value: number) => useCanvas.getState().zoomTo(value / 100)}>
                                    {ZOOM_PRESETS.map((pct) => (
                                        <Menu.RadioItem key={pct} value={pct} className="menu-item">
                                            <span className="grid h-4 w-4 place-items-center">
                                                <Menu.RadioItemIndicator>
                                                    <Icon icon={Check} size={14} />
                                                </Menu.RadioItemIndicator>
                                            </span>
                                            <span className="tabular-nums">{pct}%</span>
                                            {pct === 100 && <kbd>⌘0</kbd>}
                                        </Menu.RadioItem>
                                    ))}
                                </Menu.RadioGroup>
                                <Menu.Separator className={MENU_SEPARATOR} />
                                <Menu.Item className="menu-item" onClick={() => useCanvas.getState().fitAll()}>
                                    <span className="grid h-4 w-4 place-items-center">
                                        <Icon icon={Maximize} size={14} />
                                    </span>{' '}
                                    Zoom to fit <kbd>⇧1</kbd>
                                </Menu.Item>
                                <Menu.Item className="menu-item" disabled={!hasSelection} onClick={() => useCanvas.getState().zoomToSelection()}>
                                    <span className="grid h-4 w-4 place-items-center">
                                        <Icon icon={Scan} size={14} />
                                    </span>{' '}
                                    Zoom to selection <kbd>⇧2</kbd>
                                </Menu.Item>
                            </Menu.Popup>
                        </Menu.Positioner>
                    </Menu.Portal>
                </Menu.Root>

                <Tooltip label="Zoom in" name>
                    <button className="icon-btn" onClick={() => useCanvas.getState().zoomTo(Math.round(zoom * 100 + 10) / 100)}>
                        <Icon icon={Plus} size={16} />
                    </button>
                </Tooltip>
                <Tooltip label="Fit everything" kbd="Shift+1" name>
                    <button className="icon-btn" onClick={() => useCanvas.getState().fitAll()}>
                        <Icon icon={Maximize} size={16} />
                    </button>
                </Tooltip>
            </div>
            <Separator />

            <div className={BTN_GROUP}>
                <Menu.Root>
                    <Tooltip label="Lock" name>
                        <Menu.Trigger className="icon-btn" data-active={anyLocked}>
                            {anyLocked ? <Icon icon={Lock} size={16} /> : <Icon icon={LockOpen} size={16} />}
                        </Menu.Trigger>
                    </Tooltip>
                    <Menu.Portal>
                        <Menu.Positioner className="z-[var(--z-popup)]" side="top" sideOffset={10} align="end">
                            <Menu.Popup className="menu-popup">
                                <div className={MENU_LABEL}>Refuse gestures</div>
                                {LOCK_ROWS.map((row) => (
                                    <Menu.CheckboxItem
                                        key={row.key}
                                        className="menu-item"
                                        checked={locks[row.key]}
                                        onCheckedChange={() => useCanvas.getState().toggleLock(row.key)}
                                        closeOnClick={false}
                                    >
                                        <span className="grid h-4 w-4 place-items-center rounded border border-border-strong">
                                            <Menu.CheckboxItemIndicator>
                                                <Icon icon={Check} size={12} />
                                            </Menu.CheckboxItemIndicator>
                                        </span>
                                        <span>
                                            <span className="block">{row.label}</span>
                                            <span className="block text-xs text-text-faint">{row.hint}</span>
                                        </span>
                                    </Menu.CheckboxItem>
                                ))}
                                <Menu.Separator className={MENU_SEPARATOR} />
                                <Menu.Item className="menu-item" onClick={() => useCanvas.getState().setAllLocks(!allLocked)}>
                                    {allLocked ? <Icon icon={LockOpen} size={14} /> : <Icon icon={Lock} size={14} />}
                                    {allLocked ? 'Unlock everything' : 'Lock everything'}
                                </Menu.Item>
                                <div className="px-2.5 pb-1.5 pt-1 text-xs text-text-faint">Buttons and shortcuts still work while locked.</div>
                            </Menu.Popup>
                        </Menu.Positioner>
                    </Menu.Portal>
                </Menu.Root>

                <Menu.Root>
                    <Tooltip label="Layouts" name>
                        <Menu.Trigger className="icon-btn">
                            <Icon icon={LayoutTemplate} size={16} />
                        </Menu.Trigger>
                    </Tooltip>
                    <Menu.Portal>
                        <Menu.Positioner className="z-[var(--z-popup)]" side="top" sideOffset={10} align="end">
                            <Menu.Popup className="menu-popup min-w-48">
                                <div className={MENU_LABEL}>Saved layouts</div>
                                {layouts.length === 0 && <div className="px-2.5 pb-1.5 text-xs text-text-faint">Nothing saved yet.</div>}
                                {layouts.map((layout) => (
                                    <Menu.Item key={layout.name} className="menu-item group" onClick={() => useCanvas.getState().applyLayout(layout.name)}>
                                        <Icon icon={LayoutTemplate} size={14} className="text-text-faint" />
                                        <span className="truncate">{layout.name}</span>
                                        <Tooltip label="Delete" name>
                                            <span
                                                role="button"
                                                className="ml-auto grid h-5 w-5 place-items-center rounded text-text-faint opacity-0 hover:bg-surface-hover hover:text-text group-hover:opacity-100 group-data-[highlighted]:opacity-100"
                                                onClick={(e) => {
                                                    // The row applies; only the corner deletes.
                                                    e.stopPropagation();
                                                    useCanvas.getState().deleteLayout(layout.name);
                                                }}
                                            >
                                                <Icon icon={X} size={14} />
                                            </span>
                                        </Tooltip>
                                    </Menu.Item>
                                ))}
                                <Menu.Separator className={MENU_SEPARATOR} />
                                <Menu.Item className="menu-item" onClick={() => useUi.getState().setLayoutDialogOpen(true)}>
                                    <Icon icon={Save} size={14} /> Save current layout
                                </Menu.Item>
                            </Menu.Popup>
                        </Menu.Positioner>
                    </Menu.Portal>
                </Menu.Root>
            </div>
        </DockShell>
    );
}
