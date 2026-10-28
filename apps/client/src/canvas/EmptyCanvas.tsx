import { type ReactNode } from 'react';
import { LayoutTemplate, Type } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';
import { centerWorld } from '@/actions/action-reach';
import { applyLayoutAction, createNodeAction, createTextAction, showViewOnCanvasAction } from '@/actions/client-actions';
import { ProviderRows } from '@/agents/ProviderRows';
import { emptyCanvasSections, type EmptyCanvasTile } from '@/canvas/empty-canvas';
import { NODE_KIND_ICONS } from '@/canvas/node-icons';
import { ADD_NODE_SHORTCUTS } from '@/canvas/shortcuts';
import { DesignTile } from '@/design/DesignAddItem';
import { useDesignOffered } from '@/design/design-create';
import { APP_SHORTCUTS } from '@/shell/shortcuts';
import { useCanvas, useCanvasStore } from '@/state/canvas';
import { useDocument } from '@/state/document';
import { shownFolderOf, useProject } from '@/state/project';
import { useProviders } from '@adecore/agents-react/state';
import { useUi } from '@/state/ui';
import { Icon, Kbd, SectionLabel, Tile } from '@adecore/ui';
import type { Shortcut } from '@adecore/ui';
import { AgentIcon } from '@adecore/agents-react/providers';

interface TileLook {
    icon: ReactNode;
    title: string;
    description?: string;
    shortcut?: Shortcut;
    run(): void;
}

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
    const design = useDesignOffered();
    const sections = emptyCanvasSections({ providers, hasFolder, design, layouts, views });

    const center = () => centerWorld(canvasStore.getState());

    const lookOf = (tile: Exclude<EmptyCanvasTile, { kind: 'design' }>): TileLook => {
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
                    icon: <Icon icon={NODE_KIND_ICONS[tile.node]} size={16} />,
                    title: t(`kinds.${tile.node}`),
                    description: t(`empty.node.${tile.node}`),
                    shortcut: ADD_NODE_SHORTCUTS[tile.node],
                    run: () => void createNodeAction(tile.node)
                };
            case 'file':
                return {
                    icon: <Icon icon={NODE_KIND_ICONS.file} size={16} />,
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
                    icon: <Icon icon={NODE_KIND_ICONS[tile.view]} size={16} />,
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
                                // A design asks for its CLI in a menu, which the tile opens.
                                if (tile.kind === 'design') {
                                    return <DesignTile key={tile.id} at={center} />;
                                }

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
