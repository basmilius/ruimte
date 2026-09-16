import { useMemo, type ReactNode } from 'react';
import { Bot, FileText, Globe, LayoutGrid, LayoutTemplate, LoaderCircle, MessageSquare, PenTool, StickyNote, Terminal, Type, Workflow } from 'lucide-react';
import { AgentIcon } from '@/agents/AgentIcon';
import { emptyCanvasSections, emptyCanvasSize, type EmptyCanvasTile } from '@/canvas/empty-canvas';
import { toWorld } from '@/canvas/math';
import { ADD_NODE_SHORTCUTS } from '@/canvas/shortcuts';
import { showOnCanvas } from '@/project/views';
import { addAgentNodeAtCenter, addNodeAtCenter } from '@/shell/commands';
import { APP_SHORTCUTS } from '@/shell/shortcuts';
import { useCanvas, useCanvasStore } from '@/state/canvas';
import { useDocument } from '@/state/document';
import { useProject } from '@/state/project';
import { useProviders } from '@/state/providers';
import { useUi } from '@/state/ui';
import { SECTION_LABEL, TOOLTIP_KBD } from '@/ui/classes';
import { Icon } from '@/ui/Icon';
import { Kbd } from '@/ui/Kbd';
import type { Shortcut } from '@/ui/shortcut';
import { Tile } from '@/ui/Tile';
import { Tooltip } from '@/ui/Tooltip';

interface TileLook {
    icon: ReactNode;
    title: string;
    description?: string;
    shortcut?: Shortcut;
    disabled?: boolean;
    run(): void;
}

const NODE_LOOK = {
    chat: { icon: MessageSquare, title: 'Chat', description: 'Pick a model' },
    terminal: { icon: Terminal, title: 'Terminal', description: 'A shell' },
    browser: { icon: Globe, title: 'Browser', description: 'A web page' },
    note: { icon: StickyNote, title: 'Note', description: 'Markdown' },
    group: { icon: LayoutGrid, title: 'Group', description: 'A frame around nodes' }
} as const;

/* A section of the grid, and the order its tiles take in the tab order. */
const SECTIONS = [
    { key: 'agents', label: 'Agents' },
    { key: 'place', label: 'Add' },
    { key: 'project', label: 'From this project' }
] as const;

/*
 * What an empty canvas offers, as tiles that put the node in the middle of the camera the way the dock
 * does. It sits over the canvas in screen space, clear of the dock, and shrinks with its cell: a row
 * of icons in a narrow cell and only the sentence in a tiny one. Clicking beside the tiles still
 * reaches the canvas, which box-selects as it always does.
 */
export function EmptyCanvas() {
    const canvasStore = useCanvasStore();
    const viewport = useCanvas((s) => s.viewport);
    const layouts = useCanvas((s) => s.layouts);
    const views = useDocument((s) => s.views);
    const hasFolder = useProject((s) => s.current?.folder != null);
    const providers = useProviders((s) => s.providers);
    const loaded = useProviders((s) => s.loaded);
    const sections = useMemo(() => emptyCanvasSections({ providers, loaded, hasFolder, layouts, views }), [providers, loaded, hasFolder, layouts, views]);
    const size = emptyCanvasSize(viewport);

    const center = (): { x: number; y: number } => {
        const state = canvasStore.getState();
        return toWorld(state.camera, { x: state.viewport.w / 2, y: state.viewport.h / 2 });
    };

    const lookOf = (tile: EmptyCanvasTile): TileLook => {
        switch (tile.kind) {
            case 'agent': {
                const provider = providers.find((entry) => entry.kind === tile.provider);
                return {
                    icon: <AgentIcon kind={tile.provider} size={16} />,
                    title: tile.name,
                    description: tile.target === 'chat' ? 'Chat' : 'In a terminal',
                    run: () => {
                        if (provider) {
                            addAgentNodeAtCenter(tile.target, provider);
                        }
                    }
                };
            }
            case 'connecting':
                return {
                    icon: <Icon icon={LoaderCircle} size={16} className="animate-spin" />,
                    title: 'Connecting',
                    description: 'Asking for agents',
                    disabled: true,
                    run: () => undefined
                };
            case 'setup':
                return {
                    icon: <Icon icon={Bot} size={16} />,
                    title: 'Set up an agent',
                    description: 'No agent CLI on this machine',
                    run: () => useUi.getState().setSettings({ open: true, section: 'agents' })
                };
            case 'node': {
                const look = NODE_LOOK[tile.node];
                return {
                    icon: <Icon icon={look.icon} size={16} />,
                    title: look.title,
                    description: look.description,
                    shortcut: ADD_NODE_SHORTCUTS[tile.node],
                    run: () => void addNodeAtCenter(tile.node)
                };
            }
            case 'file':
                return {
                    icon: <Icon icon={FileText} size={16} />,
                    title: 'File',
                    description: 'From the project folder',
                    run: () => useUi.getState().openFilePicker({ kind: 'node', at: center() })
                };
            case 'text':
                return {
                    icon: <Icon icon={Type} size={16} />,
                    title: 'Text',
                    description: 'Or double-click',
                    run: () => void canvasStore.getState().addText(center())
                };
            case 'layout':
                return {
                    icon: <Icon icon={LayoutTemplate} size={16} />,
                    title: tile.name,
                    description: 'Apply this layout',
                    run: () => canvasStore.getState().applyLayout(tile.name)
                };
            case 'view':
                return {
                    icon: <Icon icon={tile.view === 'drawing' ? PenTool : Workflow} size={16} />,
                    title: tile.name,
                    description: tile.view === 'drawing' ? 'Show the drawing here' : 'Show the diagram here',
                    run: () => void showOnCanvas(tile.viewId)
                };
        }
    };

    const hint = (
        <p className="text-center text-xs text-text-muted">
            Drop files here, right-click for more, or press <Kbd shortcut={APP_SHORTCUTS.palette} className={TOOLTIP_KBD} />.
        </p>
    );

    return (
        // The bottom padding keeps the grid clear of the dock, which floats over the same cell.
        <div className="pointer-events-none absolute inset-0 grid place-items-center overflow-hidden px-4 pt-4 pb-20">
            {size === 'minimal' && hint}
            {size === 'compact' && (
                <div className="pointer-events-auto flex max-w-full flex-col items-center gap-3">
                    <div className="flex max-w-full flex-wrap justify-center gap-1">
                        {SECTIONS.flatMap(({ key }) => sections[key]).map((tile) => {
                            const look = lookOf(tile);
                            return (
                                <Tooltip key={tile.id} label={look.description ? `${look.title}: ${look.description}` : look.title} kbd={look.shortcut}>
                                    <button className="icon-btn" aria-label={look.title} disabled={look.disabled} onClick={look.run}>
                                        {look.icon}
                                    </button>
                                </Tooltip>
                            );
                        })}
                    </div>
                    {hint}
                </div>
            )}
            {size === 'full' && (
                <div className="pointer-events-auto flex max-h-full w-full max-w-3xl flex-col gap-5 overflow-auto">
                    {SECTIONS.filter(({ key }) => sections[key].length > 0).map(({ key, label }) => (
                        <section key={key} className="flex flex-col gap-2">
                            <h2 className={`${SECTION_LABEL} px-1`}>{label}</h2>
                            <div className="grid grid-cols-3 gap-2">
                                {sections[key].map((tile) => {
                                    const look = lookOf(tile);
                                    return (
                                        <Tile
                                            key={tile.id}
                                            icon={look.icon}
                                            title={look.title}
                                            description={look.description}
                                            shortcut={look.shortcut}
                                            disabled={look.disabled}
                                            onClick={look.run}
                                        />
                                    );
                                })}
                            </div>
                        </section>
                    ))}
                    {hint}
                </div>
            )}
        </div>
    );
}
