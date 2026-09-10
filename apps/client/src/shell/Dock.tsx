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
import clsx from 'clsx';
import { useShallow } from 'zustand/react/shallow';
import { AgentSubmenus } from '@/agents/AgentMenus';
import { addAgentNode } from '@/agents/nodes';
import { activeZoomPreset, toWorld, ZOOM_PRESETS } from '@/canvas/math';
import { LOCK_ROWS } from '@/canvas/locks';
import { useCanvas, type NodeKind } from '@/state/canvas';
import { useUi } from '@/state/ui';
import { StatusSummary } from '@/shell/StatusSummary';
import { Tooltip } from '@/ui/Tooltip';
import { Icon } from '@/ui/Icon';

const centerWorld = () => {
    const s = useCanvas.getState();
    return toWorld(s.camera, { x: s.viewport.w / 2, y: s.viewport.h / 2 });
};

export function Dock() {
    const { zoom, mode, locks, focusedTitle, hasSelection, layouts } = useCanvas(
        useShallow((s) => ({
            zoom: s.camera.zoom,
            mode: s.mode.kind,
            locks: s.locks,
            focusedTitle: s.mode.kind === 'node' ? s.nodes[s.mode.nodeId]?.title : null,
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

    return (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
            <div className="float pointer-events-auto flex items-center gap-2 rounded-xl p-1">
                <Tooltip label={mode === 'node' ? 'Keyboard goes to this node. Escape returns to the canvas.' : 'Keyboard goes to the canvas'}>
                    <div
                        className={clsx(
                            'flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium',
                            mode === 'node' ? 'bg-accent-soft text-accent' : 'text-text-muted'
                        )}
                    >
                        <span className={clsx('h-1.5 w-1.5 rounded-full', mode === 'node' ? 'bg-accent' : 'bg-text-faint')} />
                        {mode === 'node' ? <span className="max-w-40 truncate">{focusedTitle}</span> : 'Canvas'}
                    </div>
                </Tooltip>
                <span className="h-5 w-px bg-border" />
                <StatusSummary />

                <Menu.Root>
                    <Tooltip label="Add">
                        <Menu.Trigger className="icon-btn">
                            <Icon icon={Plus} size={16} />
                        </Menu.Trigger>
                    </Tooltip>
                    <Menu.Portal>
                        <Menu.Positioner className="z-50" side="top" sideOffset={10} align="start">
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
                                <Menu.Separator className="menu-separator" />
                                <Menu.Item className="menu-item" onClick={() => useCanvas.getState().addText(centerWorld())}>
                                    <Icon icon={Type} size={14} /> Text <kbd>dbl-click</kbd>
                                </Menu.Item>
                            </Menu.Popup>
                        </Menu.Positioner>
                    </Menu.Portal>
                </Menu.Root>

                <span className="h-5 w-px bg-border" />
                <div className="btn-group">
                    <Tooltip label="Zoom out">
                        <button className="icon-btn" onClick={() => useCanvas.getState().zoomTo(Math.round(zoom * 100 - 10) / 100)}>
                            <Icon icon={Minus} size={16} />
                        </button>
                    </Tooltip>
                    <Menu.Root>
                        <Tooltip label="Zoom presets">
                            <Menu.Trigger className="h-8 min-w-14 rounded-lg px-1 text-xs tabular-nums text-text-muted hover:bg-surface-sunken hover:text-text data-[popup-open]:bg-surface-sunken data-[popup-open]:text-text">
                                {zoomPct}%
                            </Menu.Trigger>
                        </Tooltip>
                        <Menu.Portal>
                            <Menu.Positioner className="z-50" side="top" sideOffset={10} align="center">
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
                                    <Menu.Separator className="menu-separator" />
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

                    <Tooltip label="Zoom in">
                        <button className="icon-btn" onClick={() => useCanvas.getState().zoomTo(Math.round(zoom * 100 + 10) / 100)}>
                            <Icon icon={Plus} size={16} />
                        </button>
                    </Tooltip>
                    <Tooltip label="Fit everything" kbd="Shift+1">
                        <button className="icon-btn" onClick={() => useCanvas.getState().fitAll()}>
                            <Icon icon={Maximize} size={16} />
                        </button>
                    </Tooltip>
                </div>
                <span className="h-5 w-px bg-border" />

                <div className="btn-group">
                    <Menu.Root>
                        <Tooltip label="Lock">
                            <Menu.Trigger className="icon-btn" data-active={anyLocked}>
                                {anyLocked ? <Icon icon={Lock} size={16} /> : <Icon icon={LockOpen} size={16} />}
                            </Menu.Trigger>
                        </Tooltip>
                        <Menu.Portal>
                            <Menu.Positioner className="z-50" side="top" sideOffset={10} align="end">
                                <Menu.Popup className="menu-popup">
                                    <div className="menu-label">Refuse gestures</div>
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
                                    <Menu.Separator className="menu-separator" />
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
                        <Tooltip label="Layouts">
                            <Menu.Trigger className="icon-btn">
                                <Icon icon={LayoutTemplate} size={16} />
                            </Menu.Trigger>
                        </Tooltip>
                        <Menu.Portal>
                            <Menu.Positioner className="z-50" side="top" sideOffset={10} align="end">
                                <Menu.Popup className="menu-popup min-w-48">
                                    <div className="menu-label">Saved layouts</div>
                                    {layouts.length === 0 && <div className="px-2.5 pb-1.5 text-xs text-text-faint">Nothing saved yet.</div>}
                                    {layouts.map((layout) => (
                                        <Menu.Item key={layout.name} className="menu-item group" onClick={() => useCanvas.getState().applyLayout(layout.name)}>
                                            <Icon icon={LayoutTemplate} size={14} className="text-text-faint" />
                                            <span className="truncate">{layout.name}</span>
                                            <Tooltip label="Delete">
                                                <span
                                                    role="button"
                                                    className="ml-auto grid h-5 w-5 place-items-center rounded text-text-faint opacity-0 hover:bg-surface-sunken hover:text-text group-hover:opacity-100 group-data-[highlighted]:opacity-100"
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
                                    <Menu.Separator className="menu-separator" />
                                    <Menu.Item className="menu-item" onClick={() => useUi.getState().setLayoutDialogOpen(true)}>
                                        <Icon icon={Save} size={14} /> Save current layout
                                    </Menu.Item>
                                </Menu.Popup>
                            </Menu.Positioner>
                        </Menu.Portal>
                    </Menu.Root>
                </div>
            </div>
        </div>
    );
}
