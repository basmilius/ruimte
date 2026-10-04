import { Fragment, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, FileText, Frame, Globe, Heading, Minus, PenTool, Workflow, Terminal } from 'lucide-react';
import { isOpenableView, viewIconOf, type ProjectView, type ProviderInfo } from '@ruimte/contracts';
import { ProviderRows } from '@/agents/ProviderRows';
import { AgentSubmenu } from '@/agents/AgentMenus';
import { agentTargetLabel, type AgentTarget } from '@/agents/nodes';
import { createViewAction } from '@/actions/client-actions';
import { newSubheaderView, showView } from '@/project/views';
import { ViewGlyph } from '@/project/ViewGlyph';
import { SplitItems, ViewMenuItems } from '@/shell/ViewMenuItems';
import { useDocument } from '@/state/document';
import { shownFolderOf, useProject } from '@/state/project';
import { Tile, cameThroughPortal, Icon, Menu, Kbd, ContextMenu, SectionLabel } from '@basmilius/desktop-ui';
import { labelCollator } from '@basmilius/desktop-ui/format';
import { useUi } from '@/state/ui';
import { CANVAS_SHORTCUTS, viewShortcut } from '@/canvas/shortcuts';
import { useBrowserDisplayTitle } from '@/browser/title';

function ViewName({ view, className }: { view: ProjectView; className: string }) {
    const title = useBrowserDisplayTitle(view.id, view.name ?? '', 'titleSource' in view ? view.titleSource : undefined);
    return <span className={className}>{view.kind === 'browser' ? title : view.name}</span>;
}

/* A row of one of the two lists below, with the label it is put in order by. */
interface NewViewEntry {
    id: string;
    label: string;
    node: ReactNode;
}

/*
 * The rows of one list in the order the language reads their labels. Sorting is by what a person
 * sees, so the Dutch interface reads Kopje before Scheiding where the English one reads Separator
 * before Subheader, and a row nobody is offered takes its place with it.
 */
function inOrder(entries: (NewViewEntry | false)[]): ReactNode[] {
    const order = labelCollator();
    return entries
        .filter((entry): entry is NewViewEntry => entry !== false)
        .sort((one, other) => order.compare(one.label, other.label))
        .map((entry) => <Fragment key={entry.id}>{entry.node}</Fragment>);
}

export function NewViewTiles({ size = 'sm' }: { size?: 'sm' | 'md' }) {
    const { t } = useTranslation('shell');
    const hasFolder = useProject((s) => shownFolderOf(s.current) !== null);
    const tools = [
        { kind: 'terminal', icon: Terminal, run: () => void createViewAction('terminal') },
        { kind: 'browser', icon: Globe, run: () => useUi.getState().setViewDialog({ kind: 'new-browser' }) },
        ...(hasFolder ? [{ kind: 'file', icon: FileText, run: () => useUi.getState().openFilePicker({ kind: 'view' }) }] : []),
        { kind: 'canvas', icon: Frame, run: () => void createViewAction('canvas') },
        { kind: 'diagram', icon: Workflow, run: () => void createViewAction('diagram') },
        { kind: 'drawing', icon: PenTool, run: () => void createViewAction('drawing') }
    ];
    return (
        <div className="flex flex-col gap-6">
            <ProviderRows onPick={(provider) => void createViewAction('chat', { provider: provider.kind })} />
            <section className="flex flex-col gap-2">
                <SectionLabel render={<h2 />} className="px-1">
                    {t('projectStart.open')}
                </SectionLabel>
                <div className="grid grid-cols-[repeat(auto-fit,minmax(88px,1fr))] gap-2">
                    {tools.map((tool) => (
                        <Tile
                            key={tool.kind}
                            className="min-h-22 flex-col justify-center gap-2! text-center [&>span:last-child]:grow-0 [&>span:last-child]:items-center [&>span:first-child]:bg-transparent"
                            size={size}
                            icon={<Icon icon={tool.icon} size={20} />}
                            title={t(`viewKinds.${tool.kind}`)}
                            onClick={tool.run}
                        />
                    ))}
                </div>
            </section>
        </div>
    );
}

/*
 * What the plus in the sidebar offers: a canvas, or one session with no canvas around it, and under
 * a line the two rows that divide the list rather than standing in it. The agent submenus are the
 * ones the dock uses, so the CLI list can never drift apart between the two. Each of the two groups
 * is alphabetical on its own: the line says what a group is for, and sorting across it would lose
 * that.
 */
export function NewViewItems() {
    const { t } = useTranslation('shell');
    /* A file comes out of the open folder, so a project without one has nothing to pick from. */
    const hasFolder = useProject((s) => shownFolderOf(s.current) !== null);
    const pickAgent = (target: AgentTarget, provider: ProviderInfo): void => void createViewAction(target, { provider: provider.kind });
    return (
        <>
            {inOrder([
                {
                    id: 'canvas',
                    label: t('viewKinds.canvas'),
                    node: (
                        <Menu.Item onClick={() => void createViewAction('canvas')}>
                            <Icon icon={Frame} size={14} /> {t('viewKinds.canvas')} <Kbd shortcut={CANVAS_SHORTCUTS.newView} />
                        </Menu.Item>
                    )
                },
                {
                    id: 'drawing',
                    label: t('viewKinds.drawing'),
                    node: (
                        <Menu.Item onClick={() => void createViewAction('drawing')}>
                            <Icon icon={PenTool} size={14} /> {t('viewKinds.drawing')}
                        </Menu.Item>
                    )
                },
                {
                    id: 'diagram',
                    label: t('viewKinds.diagram'),
                    node: (
                        <Menu.Item onClick={() => void createViewAction('diagram')}>
                            <Icon icon={Workflow} size={14} /> {t('viewKinds.diagram')}
                        </Menu.Item>
                    )
                },
                {
                    id: 'terminal',
                    label: t('viewKinds.terminal'),
                    node: (
                        <Menu.Item onClick={() => void createViewAction('terminal')}>
                            <Icon icon={Terminal} size={14} /> {t('viewKinds.terminal')}
                        </Menu.Item>
                    )
                },
                { id: 'agent-chat', label: agentTargetLabel('chat'), node: <AgentSubmenu target="chat" onPick={pickAgent} /> },
                { id: 'agent-terminal', label: agentTargetLabel('terminal'), node: <AgentSubmenu target="terminal" onPick={pickAgent} /> },
                {
                    id: 'browser',
                    label: t('viewKinds.browser'),
                    node: (
                        <Menu.Item onClick={() => useUi.getState().setViewDialog({ kind: 'new-browser' })}>
                            <Icon icon={Globe} size={14} /> {t('viewKinds.browser')}
                        </Menu.Item>
                    )
                },
                hasFolder && {
                    id: 'file',
                    label: t('viewMenu.filePick'),
                    node: (
                        <Menu.Item onClick={() => useUi.getState().openFilePicker({ kind: 'view' })}>
                            <Icon icon={FileText} size={14} /> {t('viewMenu.filePick')}
                        </Menu.Item>
                    )
                }
            ])}
            <Menu.Separator />
            {inOrder([
                {
                    id: 'separator',
                    label: t('viewKinds.separator'),
                    node: (
                        <Menu.Item onClick={() => void createViewAction('separator')}>
                            <Icon icon={Minus} size={14} /> {t('viewKinds.separator')}
                        </Menu.Item>
                    )
                },
                {
                    id: 'subheader',
                    label: t('viewKinds.subheader'),
                    node: (
                        <Menu.Item onClick={() => void newSubheaderView()}>
                            <Icon icon={Heading} size={14} /> {t('viewKinds.subheader')}
                        </Menu.Item>
                    )
                }
            ])}
        </>
    );
}

/* The view segment of the toolbar's breadcrumb: every view of this project, and the ways to change the list. */
export function ViewMenu() {
    const { t } = useTranslation('shell');
    const views = useDocument((s) => s.views);
    const activeViewId = useDocument((s) => s.activeViewId);
    const active = views.find((view) => view.id === activeViewId);
    if (!active) {
        return null;
    }
    return (
        // The right-click offers what a cell's bar does; `display: contents`, so the wrapper changes no layout.
        <ContextMenu.Root>
            <ContextMenu.Trigger
                className="contents"
                onContextMenu={(event) => {
                    if (cameThroughPortal(event)) {
                        event.preventBaseUIHandler();
                    }
                }}
            >
                <Menu.Root>
                    <Menu.Trigger className="flex h-8 min-w-0 items-center gap-2 rounded-md px-2 text-left hover:bg-surface-hover data-[popup-open]:bg-surface-active">
                        <ViewGlyph
                            id={active.id}
                            kind={active.kind}
                            icon={viewIconOf(active)}
                            provider={active.kind === 'chat' || active.kind === 'terminal' ? active.node.provider : null}
                            path={active.kind === 'file' ? active.path : null}
                        />
                        <ViewName view={active} className="truncate text-sm text-text" />
                        <Icon icon={ChevronDown} size={14} className="shrink-0 text-text-muted" />
                    </Menu.Trigger>
                    <Menu.Popup className="min-w-52">
                        <Menu.Label>{t('viewMenu.views')}</Menu.Label>
                        {views.filter(isOpenableView).map((view, index) => (
                            <Menu.Item key={view.id} onClick={() => showView(view.id)}>
                                <Menu.Check kind="radio" checked={view.id === activeViewId} />
                                <ViewGlyph
                                    id={view.id}
                                    kind={view.kind}
                                    icon={viewIconOf(view)}
                                    provider={view.kind === 'chat' || view.kind === 'terminal' ? view.node.provider : null}
                                    path={view.kind === 'file' ? view.path : null}
                                />
                                <ViewName view={view} className="truncate" />
                                {/* The first nine have a shortcut of their own; the rest are one click away. */}
                                {index < 9 && <Kbd shortcut={viewShortcut(index)!} />}
                            </Menu.Item>
                        ))}
                        <Menu.Separator />
                        {/* Here the items follow the list of views, so they say what they are; under
                            the sidebar's plus they would repeat what the plus already says. */}
                        <Menu.Label>{t('viewMenu.newView')}</Menu.Label>
                        <NewViewItems />
                        <Menu.Separator />
                        <SplitItems separated />
                        <ViewMenuItems viewId={active.id} kind={active.kind} />
                    </Menu.Popup>
                </Menu.Root>
            </ContextMenu.Trigger>
            <ContextMenu.Popup className="min-w-52">
                <SplitItems separated />
                <ViewMenuItems viewId={active.id} kind={active.kind} />
            </ContextMenu.Popup>
        </ContextMenu.Root>
    );
}
