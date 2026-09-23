import { Fragment, useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Menu } from '@base-ui-components/react/menu';
import { Check, ChevronDown, FileText, Frame, Globe, Heading, Minus, PenTool, Workflow, Terminal } from 'lucide-react';
import { isOpenableView, viewIconOf, type ProjectView, type ProviderInfo } from '@ruimte/contracts';
import { AgentIcon } from '@/agents/AgentIcon';
import { AgentSubmenu } from '@/agents/AgentMenus';
import { agentTargetLabel, type AgentTarget } from '@/agents/nodes';
import { createViewAction } from '@/actions/client-actions';
import { newSubheaderView, showView } from '@/project/views';
import { ViewGlyph } from '@/project/ViewGlyph';
import { SplitItems, ViewMenuItems } from '@/shell/ViewMenuItems';
import { useDocument } from '@/state/document';
import { useProject } from '@/state/project';
import { useProviders } from '@/state/providers';
import { Tile } from '@/ui/Tile';
import { useUi } from '@/state/ui';
import { labelCollator } from '@/format/locale';
import { MENU_LABEL, MENU_SEPARATOR } from '@/ui/classes';
import { Icon } from '@/ui/Icon';
import { CANVAS_SHORTCUTS, viewShortcut } from '@/canvas/shortcuts';
import { Kbd } from '@/ui/Kbd';
import { MenuPopup } from '@/ui/MenuPopup';
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
const inOrder = (entries: (NewViewEntry | false)[]): ReactNode[] => {
    const order = labelCollator();
    return entries
        .filter((entry): entry is NewViewEntry => entry !== false)
        .sort((one, other) => order.compare(one.label, other.label))
        .map((entry) => <Fragment key={entry.id}>{entry.node}</Fragment>);
};

/* Dividers are left out of the start screen because there are no views to group yet. */
export function NewViewTiles({ size = 'sm' }: { size?: 'sm' | 'md' }) {
    const { t } = useTranslation('shell');
    const hasFolder = useProject((s) => s.current?.folder != null);
    const providers = useProviders((s) => s.providers);
    const agents = useMemo(() => providers.filter((provider) => provider.installed && provider.capabilities.chat), [providers]);
    return (
        <div className="grid grid-cols-2 gap-1.5">
            {inOrder([
                {
                    id: 'canvas',
                    label: t('viewKinds.canvas'),
                    node: (
                        <Tile
                            size={size}
                            icon={<Icon icon={Frame} size={14} />}
                            title={t('viewKinds.canvas')}
                            onClick={() => void createViewAction('canvas')}
                        />
                    )
                },
                {
                    id: 'drawing',
                    label: t('viewKinds.drawing'),
                    node: (
                        <Tile
                            size={size}
                            icon={<Icon icon={PenTool} size={14} />}
                            title={t('viewKinds.drawing')}
                            onClick={() => void createViewAction('drawing')}
                        />
                    )
                },
                {
                    id: 'diagram',
                    label: t('viewKinds.diagram'),
                    node: (
                        <Tile
                            size={size}
                            icon={<Icon icon={Workflow} size={14} />}
                            title={t('viewKinds.diagram')}
                            onClick={() => void createViewAction('diagram')}
                        />
                    )
                },
                {
                    id: 'terminal',
                    label: t('viewKinds.terminal'),
                    node: (
                        <Tile
                            size={size}
                            icon={<Icon icon={Terminal} size={14} />}
                            title={t('viewKinds.terminal')}
                            onClick={() => void createViewAction('terminal')}
                        />
                    )
                },
                ...agents.map((provider) => ({
                    id: `agent:${provider.kind}`,
                    label: provider.name,
                    node: (
                        <Tile
                            size={size}
                            icon={<AgentIcon kind={provider.kind} size={14} />}
                            title={provider.name}
                            onClick={() => void createViewAction('chat', { provider: provider.kind })}
                        />
                    )
                })),
                {
                    id: 'browser',
                    label: t('viewKinds.browser'),
                    node: (
                        <Tile
                            size={size}
                            icon={<Icon icon={Globe} size={14} />}
                            title={t('viewKinds.browser')}
                            onClick={() => useUi.getState().setViewDialog({ kind: 'new-browser' })}
                        />
                    )
                },
                hasFolder && {
                    id: 'file',
                    label: t('viewKinds.file'),
                    node: (
                        <Tile
                            size={size}
                            icon={<Icon icon={FileText} size={14} />}
                            title={t('viewKinds.file')}
                            onClick={() => useUi.getState().openFilePicker({ kind: 'view' })}
                        />
                    )
                }
            ])}
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
    const hasFolder = useProject((s) => s.current?.folder != null);
    const pickAgent = (target: AgentTarget, provider: ProviderInfo): void => void createViewAction(target, { provider: provider.kind });
    return (
        <>
            {inOrder([
                {
                    id: 'canvas',
                    label: t('viewKinds.canvas'),
                    node: (
                        <Menu.Item className="menu-item" onClick={() => void createViewAction('canvas')}>
                            <Icon icon={Frame} size={14} /> {t('viewKinds.canvas')} <Kbd shortcut={CANVAS_SHORTCUTS.newView} />
                        </Menu.Item>
                    )
                },
                {
                    id: 'drawing',
                    label: t('viewKinds.drawing'),
                    node: (
                        <Menu.Item className="menu-item" onClick={() => void createViewAction('drawing')}>
                            <Icon icon={PenTool} size={14} /> {t('viewKinds.drawing')}
                        </Menu.Item>
                    )
                },
                {
                    id: 'diagram',
                    label: t('viewKinds.diagram'),
                    node: (
                        <Menu.Item className="menu-item" onClick={() => void createViewAction('diagram')}>
                            <Icon icon={Workflow} size={14} /> {t('viewKinds.diagram')}
                        </Menu.Item>
                    )
                },
                {
                    id: 'terminal',
                    label: t('viewKinds.terminal'),
                    node: (
                        <Menu.Item className="menu-item" onClick={() => void createViewAction('terminal')}>
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
                        <Menu.Item className="menu-item" onClick={() => useUi.getState().setViewDialog({ kind: 'new-browser' })}>
                            <Icon icon={Globe} size={14} /> {t('viewKinds.browser')}
                        </Menu.Item>
                    )
                },
                hasFolder && {
                    id: 'file',
                    label: t('viewMenu.filePick'),
                    node: (
                        <Menu.Item className="menu-item" onClick={() => useUi.getState().openFilePicker({ kind: 'view' })}>
                            <Icon icon={FileText} size={14} /> {t('viewMenu.filePick')}
                        </Menu.Item>
                    )
                }
            ])}
            <Menu.Separator className={MENU_SEPARATOR} />
            {inOrder([
                {
                    id: 'separator',
                    label: t('viewKinds.separator'),
                    node: (
                        <Menu.Item className="menu-item" onClick={() => void createViewAction('separator')}>
                            <Icon icon={Minus} size={14} /> {t('viewKinds.separator')}
                        </Menu.Item>
                    )
                },
                {
                    id: 'subheader',
                    label: t('viewKinds.subheader'),
                    node: (
                        <Menu.Item className="menu-item" onClick={() => void newSubheaderView()}>
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
            <MenuPopup className="min-w-52">
                <div className={MENU_LABEL}>{t('viewMenu.views')}</div>
                {views.filter(isOpenableView).map((view, index) => (
                    <Menu.Item key={view.id} className="menu-item" onClick={() => showView(view.id)}>
                        <ViewGlyph
                            id={view.id}
                            kind={view.kind}
                            icon={viewIconOf(view)}
                            provider={view.kind === 'chat' || view.kind === 'terminal' ? view.node.provider : null}
                            path={view.kind === 'file' ? view.path : null}
                        />
                        <ViewName view={view} className="truncate" />
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
                            the sidebar's plus they would repeat what the plus already says. */}
                <div className={MENU_LABEL}>{t('viewMenu.newView')}</div>
                <NewViewItems />
                <Menu.Separator className={MENU_SEPARATOR} />
                <SplitItems separated />
                <ViewMenuItems viewId={active.id} kind={active.kind} />
            </MenuPopup>
        </Menu.Root>
    );
}
