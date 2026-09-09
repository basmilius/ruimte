import { Menu } from '@base-ui-components/react/menu';
import { Bot, Check, ChevronRight, Globe, Lock, LockOpen, Maximize, MessageSquare, Minus, Moon, Plus, Scan, Sun, Terminal, Type } from 'lucide-react';
import clsx from 'clsx';
import { useShallow } from 'zustand/react/shallow';
import type { AgentKind } from '@ruimte/contracts';
import { activeZoomPreset, toWorld, ZOOM_PRESETS } from '@/canvas/math';
import { useCanvas, type Locks, type NodeKind } from '@/state/canvas';
import { useTheme } from '@/state/theme';
import { StatusSummary } from '@/shell/StatusSummary';
import { Tooltip } from '@/ui/Tooltip';

const LOCK_ROWS: { key: keyof Locks; label: string; hint: string }[] = [
    { key: 'pan', label: 'Pan', hint: 'The map stops sliding' },
    { key: 'zoom', label: 'Zoom', hint: 'Wheel and pinch are ignored' },
    { key: 'move', label: 'Move nodes', hint: 'Nodes stay where they are' },
    { key: 'resize', label: 'Resize nodes', hint: 'Handles are hidden' }
];

// Claude Code and Codex have a chat backend; the others open a terminal with the CLI already started.
const AGENTS: Array<{ label: string; kind: NodeKind; command?: string; provider?: AgentKind }> = [
    { label: 'Claude Code', kind: 'chat' },
    { label: 'Codex', kind: 'chat', provider: 'codex' },
    { label: 'Gemini', kind: 'terminal', command: 'gemini' },
    { label: 'Copilot', kind: 'terminal', command: 'copilot' }
];

const centerWorld = () => {
    const s = useCanvas.getState();
    return toWorld(s.camera, { x: s.viewport.w / 2, y: s.viewport.h / 2 });
};

function Submenu({ label, icon, children }: { label: string; icon: React.ReactNode; children: React.ReactNode }) {
    return (
        <Menu.SubmenuRoot>
            <Menu.SubmenuTrigger className="menu-item">
                {icon} {label}
                <ChevronRight size={14} className="ml-auto text-text-faint" />
            </Menu.SubmenuTrigger>
            <Menu.Portal>
                <Menu.Positioner className="z-50" sideOffset={4} alignOffset={-4}>
                    <Menu.Popup className="menu-popup">{children}</Menu.Popup>
                </Menu.Positioner>
            </Menu.Portal>
        </Menu.SubmenuRoot>
    );
}

export function Dock() {
    const { zoom, mode, locks, focusedTitle, hasSelection } = useCanvas(
        useShallow((s) => ({
            zoom: s.camera.zoom,
            mode: s.mode.kind,
            locks: s.locks,
            focusedTitle: s.mode.kind === 'node' ? s.nodes[s.mode.nodeId]?.title : null,
            hasSelection: s.selection.length > 0
        }))
    );
    const resolved = useTheme((t) => t.resolved);
    const anyLocked = Object.values(locks).some(Boolean);
    const allLocked = Object.values(locks).every(Boolean);
    const zoomPct = Math.round(zoom * 100);
    const preset = activeZoomPreset(zoom);

    const add = (kind: NodeKind, options?: { title?: string; command?: string; provider?: AgentKind }) => {
        useCanvas.getState().addNode(kind, centerWorld(), options);
    };

    return (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
            <div className="float pointer-events-auto flex items-center gap-2 rounded-xl p-1">
                <Tooltip label={mode === 'node' ? 'Keyboard goes to this node. Escape returns to the canvas.' : 'Keyboard goes to the canvas'}>
                    <div
                        className={clsx(
                            'flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium',
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
                            <Plus size={17} />
                        </Menu.Trigger>
                    </Tooltip>
                    <Menu.Portal>
                        <Menu.Positioner className="z-50" side="top" sideOffset={10} align="start">
                            <Menu.Popup className="menu-popup">
                                <Menu.Item className="menu-item" onClick={() => add('terminal')}>
                                    <Terminal size={14} /> Terminal
                                </Menu.Item>
                                <Menu.Item className="menu-item" onClick={() => add('chat')}>
                                    <MessageSquare size={14} /> Chat
                                </Menu.Item>
                                <Submenu label="Agent" icon={<Bot size={14} />}>
                                    {AGENTS.map((agent) => (
                                        <Menu.Item
                                            key={agent.label}
                                            className="menu-item"
                                            onClick={() =>
                                                add(
                                                    agent.kind,
                                                    agent.provider
                                                        ? { title: agent.label, provider: agent.provider }
                                                        : agent.kind === 'terminal'
                                                          ? { title: agent.label, command: agent.command }
                                                          : undefined
                                                )
                                            }
                                        >
                                            <Bot size={14} className="text-text-faint" /> {agent.label}
                                        </Menu.Item>
                                    ))}
                                </Submenu>
                                <Menu.Item className="menu-item" onClick={() => add('browser')}>
                                    <Globe size={14} /> Browser
                                </Menu.Item>
                                <Menu.Separator className="menu-separator" />
                                <Menu.Item className="menu-item" onClick={() => useCanvas.getState().addText(centerWorld())}>
                                    <Type size={14} /> Text <kbd>dbl-click</kbd>
                                </Menu.Item>
                            </Menu.Popup>
                        </Menu.Positioner>
                    </Menu.Portal>
                </Menu.Root>

                <span className="h-5 w-px bg-border" />
                <div className="btn-group">
                    <Tooltip label="Zoom out">
                        <button className="icon-btn" onClick={() => useCanvas.getState().zoomTo(Math.round(zoom * 100 - 10) / 100)}>
                            <Minus size={15} />
                        </button>
                    </Tooltip>
                    <Menu.Root>
                        <Tooltip label="Zoom presets">
                            <Menu.Trigger className="h-8 min-w-14 rounded-lg px-1 text-[12px] tabular-nums text-text-muted hover:bg-surface-sunken hover:text-text data-[popup-open]:bg-surface-sunken data-[popup-open]:text-text">
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
                                                        <Check size={13} strokeWidth={2.5} />
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
                                            <Maximize size={13} />
                                        </span>{' '}
                                        Zoom to fit <kbd>⇧1</kbd>
                                    </Menu.Item>
                                    <Menu.Item className="menu-item" disabled={!hasSelection} onClick={() => useCanvas.getState().zoomToSelection()}>
                                        <span className="grid h-4 w-4 place-items-center">
                                            <Scan size={13} />
                                        </span>{' '}
                                        Zoom to selection <kbd>⇧2</kbd>
                                    </Menu.Item>
                                </Menu.Popup>
                            </Menu.Positioner>
                        </Menu.Portal>
                    </Menu.Root>

                    <Tooltip label="Zoom in">
                        <button className="icon-btn" onClick={() => useCanvas.getState().zoomTo(Math.round(zoom * 100 + 10) / 100)}>
                            <Plus size={15} />
                        </button>
                    </Tooltip>
                    <Tooltip label="Fit everything" kbd="Shift+1">
                        <button className="icon-btn" onClick={() => useCanvas.getState().fitAll()}>
                            <Maximize size={15} />
                        </button>
                    </Tooltip>
                </div>
                <span className="h-5 w-px bg-border" />

                <div className="btn-group">
                    <Menu.Root>
                        <Tooltip label="Lock">
                            <Menu.Trigger className="icon-btn" data-active={anyLocked}>
                                {anyLocked ? <Lock size={15} /> : <LockOpen size={15} />}
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
                                                    <Check size={12} strokeWidth={2.5} />
                                                </Menu.CheckboxItemIndicator>
                                            </span>
                                            <span>
                                                <span className="block">{row.label}</span>
                                                <span className="block text-[11px] text-text-faint">{row.hint}</span>
                                            </span>
                                        </Menu.CheckboxItem>
                                    ))}
                                    <Menu.Separator className="menu-separator" />
                                    <Menu.Item className="menu-item" onClick={() => useCanvas.getState().setAllLocks(!allLocked)}>
                                        {allLocked ? <LockOpen size={14} /> : <Lock size={14} />}
                                        {allLocked ? 'Unlock everything' : 'Lock everything'}
                                    </Menu.Item>
                                    <div className="px-2.5 pb-1.5 pt-1 text-[11px] text-text-faint">Buttons and shortcuts still work while locked.</div>
                                </Menu.Popup>
                            </Menu.Positioner>
                        </Menu.Portal>
                    </Menu.Root>

                    <button className="icon-btn" title="Toggle theme" onClick={() => useTheme.getState().toggle()}>
                        {resolved === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
                    </button>
                </div>
            </div>
        </div>
    );
}
