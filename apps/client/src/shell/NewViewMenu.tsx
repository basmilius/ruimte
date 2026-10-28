import { Fragment, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, Frame, Globe, Heading, Minus, PenTool, SwatchBook, Workflow, Terminal, type LucideIcon } from 'lucide-react';
import type { ProviderInfo } from '@ruimte/contracts';
import { ProviderRows } from '@/agents/ProviderRows';
import { AgentSubmenu } from '@/agents/AgentMenus';
import { agentTargetLabel, type AgentTarget } from '@/agents/nodes';
import { createViewAction } from '@/actions/client-actions';
import { newSubheaderView } from '@/project/views';
import { shownFolderOf, useProject } from '@/state/project';
import { Tile, Icon, Menu, Kbd, SectionLabel, type Shortcut } from '@adecore/ui';
import { labelCollator } from '@adecore/ui/format';
import { useUi } from '@/state/ui';
import { CANVAS_SHORTCUTS } from '@/canvas/shortcuts';

/* A row of one of the two lists below, with the label it is put in order by. */
interface NewViewEntry {
    id: string;
    label: string;
    node: ReactNode;
}

/* The rows of one list sorted by their labels in the interface language; a row nobody is offered drops out. */
function inOrder(entries: (NewViewEntry | false)[]): ReactNode[] {
    const order = labelCollator();
    return entries
        .filter((entry): entry is NewViewEntry => entry !== false)
        .sort((one, other) => order.compare(one.label, other.label))
        .map((entry) => <Fragment key={entry.id}>{entry.node}</Fragment>);
}

function itemEntry(id: string, icon: LucideIcon, label: string, onClick: () => void, shortcut?: Shortcut): NewViewEntry {
    return {
        id,
        label,
        node: (
            <Menu.Item onClick={onClick}>
                <Icon icon={icon} size={14} /> {label}
                {shortcut && (
                    <>
                        {' '}
                        <Kbd shortcut={shortcut} />
                    </>
                )}
            </Menu.Item>
        )
    };
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
                            className="min-h-22 flex-col justify-center gap-2! bg-surface-raised! text-center hover:bg-surface-hover-edged! [&>span:last-child]:grow-0 [&>span:last-child]:items-center [&>span:first-child]:bg-transparent"
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
 * What the plus in the sidebar offers: a canvas or one session, and under a line the two rows that
 * divide the list. The agent submenus are the dock's, so the CLI list never drifts apart. Each group
 * is sorted on its own, since sorting across the line would lose what it separates.
 */
export function NewViewItems() {
    const { t } = useTranslation('shell');
    /* A file comes out of the open folder, so a project without one has nothing to pick from. */
    const hasFolder = useProject((s) => shownFolderOf(s.current) !== null);
    const pickAgent = (target: AgentTarget, provider: ProviderInfo, account?: string): void =>
        void createViewAction(target, { provider: provider.kind, account });
    return (
        <>
            {inOrder([
                itemEntry('canvas', Frame, t('viewKinds.canvas'), () => void createViewAction('canvas'), CANVAS_SHORTCUTS.newView),
                itemEntry('drawing', PenTool, t('viewKinds.drawing'), () => void createViewAction('drawing')),
                itemEntry('diagram', Workflow, t('viewKinds.diagram'), () => void createViewAction('diagram')),
                itemEntry('terminal', Terminal, t('viewKinds.terminal'), () => void createViewAction('terminal')),
                { id: 'agent-chat', label: agentTargetLabel('chat'), node: <AgentSubmenu target="chat" onPick={pickAgent} /> },
                { id: 'agent-terminal', label: agentTargetLabel('terminal'), node: <AgentSubmenu target="terminal" onPick={pickAgent} /> },
                hasFolder && {
                    id: 'design',
                    label: t('viewKinds.design'),
                    node: (
                        <AgentSubmenu
                            target="chat"
                            label={t('viewKinds.design')}
                            icon={SwatchBook}
                            onPick={(_target, provider, account) => void createViewAction('design', { provider: provider.kind, account })}
                        />
                    )
                },
                itemEntry('browser', Globe, t('viewKinds.browser'), () => useUi.getState().setViewDialog({ kind: 'new-browser' })),
                hasFolder && itemEntry('file', FileText, t('viewMenu.filePick'), () => useUi.getState().openFilePicker({ kind: 'view' }))
            ])}
            <Menu.Separator />
            {inOrder([
                itemEntry('separator', Minus, t('viewKinds.separator'), () => void createViewAction('separator')),
                itemEntry('subheader', Heading, t('viewKinds.subheader'), () => void newSubheaderView())
            ])}
        </>
    );
}
