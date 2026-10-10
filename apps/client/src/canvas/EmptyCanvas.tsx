import { useMemo, type ReactNode } from 'react';
import { FileText, Globe, LayoutGrid, LayoutTemplate, MessageSquare, PenTool, StickyNote, Terminal, Type, Workflow } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';
import { applyLayoutAction, createNodeAction, createTextAction, showViewOnCanvasAction } from '@/actions/client-actions';
import { ProviderRows } from '@/agents/ProviderRows';
import { AgentIcon } from '@adecore/agents-react/agents/AgentIcon';
import { emptyCanvasSections, type EmptyCanvasTile } from '@/canvas/empty-canvas';
import { toWorld } from '@/canvas/math';
import { ADD_NODE_SHORTCUTS } from '@/canvas/shortcuts';
import { APP_SHORTCUTS } from '@/shell/shortcuts';
import { useCanvas, useCanvasStore } from '@/state/canvas';
import { useDocument } from '@/state/document';
import { shownFolderOf, useProject } from '@/state/project';
import { useProviders } from '@adecore/agents-react/state/providers';
import { useUi } from '@/state/ui';
import { Icon, Kbd, SectionLabel, Tile } from '@adecore/ui';
import type { Shortcut } from '@adecore/ui';

interface TileLook {
    icon: ReactNode;
    title: string;
    description?: string;
    shortcut?: Shortcut;
    run(): void;
}

/* The mark of a node kind; its name is `kinds.<kind>` and what it does `empty.node.<kind>`. */
const NODE_ICON = {
    chat: MessageSquare,
    terminal: Terminal,
    browser: Globe,
    note: StickyNote,
    group: LayoutGrid
} as const;

/* The sections of the grid, in the order their tiles take in the tab order. */
const SECTIONS = ['agents', 'place', 'project'] as const;

/* All start choices remain reachable by scrolling, including inside a small split cell. */
export function EmptyCanvas() {
    const { t } = useTranslation('canvas');
    const canvasStore = useCanvasStore();
    const layouts = useCanvas((s) => s.layouts);
    const views = useDocument((s) => s.views);
    const hasFolder = useProject((s) => shownFolderOf(s.current) !== null);
    const providers = useProviders((s) => s.providers);
    const sections = useMemo(() => emptyCanvasSections({ providers, hasFolder, layouts, views }), [providers, hasFolder, layouts, views]);

    const center = (): { x: number; y: number } => {
        const state = canvasStore.getState();
        return toWorld(state.camera, { x: state.viewport.w / 2, y: state.viewport.h / 2 });
    };

    const lookOf = (tile: EmptyCanvasTile): TileLook => {
        switch (tile.kind) {
            case 'agent': {
                return {
                    icon: <AgentIcon kind={tile.provider} size={16} />,
                    title: tile.name,
                    description: t('empty.agent.terminal'),
                    run: () => void createNodeAction(tile.target, { provider: tile.provider })
                };
            }
            case 'node':
                return {
                    icon: <Icon icon={NODE_ICON[tile.node]} size={16} />,
                    title: t(`kinds.${tile.node}`),
                    description: t(`empty.node.${tile.node}`),
                    shortcut: ADD_NODE_SHORTCUTS[tile.node],
                    run: () => void createNodeAction(tile.node)
                };
            case 'file':
                return {
                    icon: <Icon icon={FileText} size={16} />,
                    title: t('kinds.file'),
                    description: t('empty.file'),
                    run: () => useUi.getState().openFilePicker({ kind: 'node', at: center() })
                };
            case 'text':
                return {
                    icon: <Icon icon={Type} size={16} />,
                    title: t('kinds.text'),
                    description: t('empty.text'),
                    run: () => createTextAction(center())
                };
            case 'layout':
                return {
                    icon: <Icon icon={LayoutTemplate} size={16} />,
                    title: tile.name,
                    description: t('empty.layout'),
                    run: () => applyLayoutAction(tile.name)
                };
            case 'view':
                return {
                    icon: <Icon icon={tile.view === 'drawing' ? PenTool : Workflow} size={16} />,
                    title: tile.name,
                    description: tile.view === 'drawing' ? t('empty.drawing') : t('empty.diagram'),
                    run: () => void showViewOnCanvasAction(tile.viewId)
                };
        }
    };

    return (
        // The bottom padding keeps the grid clear of the dock, which floats over the same cell.
        <div className="pointer-events-none absolute inset-0 grid place-items-center overflow-hidden px-4 pt-4 pb-20">
            <div className="pointer-events-auto flex max-h-full w-full max-w-3xl flex-col gap-5 overflow-auto">
                <ProviderRows onPick={(provider) => void createNodeAction('chat', { provider: provider.kind })} />
                {SECTIONS.filter((key) => sections[key].length > 0).map((key) => (
                    <section key={key} className="flex flex-col gap-2">
                        <SectionLabel render={<h2 />} className="px-1">
                            {t(`empty.sections.${key}`)}
                        </SectionLabel>
                        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 140px), 1fr))' }}>
                            {sections[key].map((tile) => {
                                const look = lookOf(tile);
                                return (
                                    <Tile
                                        key={tile.id}
                                        icon={look.icon}
                                        title={look.title}
                                        description={look.description}
                                        shortcut={look.shortcut}
                                        onClick={look.run}
                                    />
                                );
                            })}
                        </div>
                    </section>
                ))}
                <p className="text-center text-xs text-text-muted">
                    <Trans t={t} i18nKey="empty.hint" components={{ palette: <Kbd shortcut={APP_SHORTCUTS.palette} variant="inline" /> }} />
                </p>
            </div>
        </div>
    );
}
