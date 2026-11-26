import { AgentIcon } from '@adecore/agents-react/providers';
import { niceScale } from '@adecore/agents-react/usage';
import { messageOf, ScrollArea, Button, Icon, IconButton, ListRow, Menu, PanelEmpty, PromptDialog, SectionLabel, ContextMenu } from '@adecore/ui';
import { isCanvasView, projectSidebarViews, type ProcessAlert, type ProcessGroupKind, type ProcessRow, type ProcessSignal } from '@ruimte/contracts';
import clsx from 'clsx';
import {
    Activity,
    AppWindow,
    ChevronRight,
    CircleStop,
    Cpu,
    MessageSquare,
    OctagonX,
    Pause,
    Server,
    Terminal,
    TriangleAlert,
    X,
    type LucideIcon
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ignoreRefusal, perform } from '@/action-port/perform';
import { chatsProjects, menuProjects } from '@/clients/project/list';
import {
    actionLabel,
    alertActions,
    alertPlacement,
    alertText,
    chartSeries,
    diskOf,
    formatBytes,
    formatPercent,
    formatRate,
    type AlertAction
} from '@/processes/format';
import { processOutline, type OutlineNode, type OutlineProject, type OutlineSource, type OutlineView, type Totals } from '@/processes/outline';
import { ProcessBars } from '@/processes/ProcessBars';
import { ProjectGlyph } from '@/project/ProjectGlyph';
import { useSidebarMachines } from '@/project/sidebar-projects';
import { ViewGlyph } from '@/project/ViewGlyph';
import { useEndpointId } from '@/state/current-endpoint';
import { useDocument } from '@/state/document';
import { useEndpoints } from '@/state/endpoints';
import { EMPTY_PROCESSES, useProcessAlerts, useProcesses } from '@/state/processes';
import { useProject } from '@/state/project';
import { useProjectList } from '@/state/project-list';
import { useToasts } from '@/state/toasts';
import { nodesOfView, useProjectNodes } from '@/state/view-nodes';
import { NODE_KIND_ICONS } from '@/surface/canvas/node-icons';
import { PanelHeaderSlot } from '@/surface/PanelHeaderSlot';
import { fireAndForget } from '@/transport-api/transport';
import { useEndpointConnection } from '@/transport/status';
import { RuimteMark } from '@/ui/RuimteMark';
import { useTransport } from '@/workspace/context';

const GROUP_ICONS: Record<ProcessGroupKind, LucideIcon> = { terminal: Terminal, chat: MessageSquare, app: AppWindow, daemon: Server, other: Cpu };

/* The sidebar's grammar: a 16px slot at the left edge of every row, 24 pixels in per level. */
const ICON_SLOT = 'grid size-4 shrink-0 place-items-center';
const ROW = 'group gap-2 text-sm text-text-muted hover:bg-surface-hover hover:text-text';
const ROW_START = 8;
const LEVEL = 24;
/* A process under another in its group, past the 24 pixels of its level. */
const DEPTH_STEP = 16;

const VALUES = 'shrink-0 text-right text-xs tabular-nums text-text-faint group-hover:text-text-muted';
const COLUMN_WIDTHS = ['w-11', 'w-16', 'w-16'] as const;

interface Target {
    pid: number;
    startTime: number;
    name: string;
}

/* A process of another user has no start time here, and without one nothing can prove it is still the same process. */
function signalable(row: ProcessRow): boolean {
    return row.readable && row.startTime !== 0;
}

/*
 * Keeps this client subscribed while the panel is on screen. The subscription is per socket on the
 * daemon, so a socket that comes back asks again. The panel lists only what belongs to Ruimte, so it
 * always asks that scope; the rest of the machine is in the machine's numbers.
 */
function useProcessesFeed(): void {
    const transport = useTransport();
    const endpointId = useEndpointId();

    useEffect(() => {
        const subscribe = (): void => {
            void fireAndForget(
                'processes.subscribe',
                transport.request('processes.subscribe', { scope: 'ruimte', sort: 'cpu' }).then((result) => useProcesses.getState().receive(endpointId, result))
            );
        };
        if (transport.status === 'open') {
            subscribe();
        }
        const offStatus = transport.subscribeStatus((status) => {
            if (status === 'open') {
                subscribe();
            }
        });
        const offSample = transport.on('processes.sample', (sample) => {
            useProcesses.getState().applySample(endpointId, sample, sample.scope === 'ruimte');
        });
        return () => {
            offStatus();
            offSample();
        };
    }, [transport, endpointId]);

    useEffect(
        () => () => {
            void fireAndForget('processes.unsubscribe', transport.request('processes.unsubscribe', {}));
        },
        [transport]
    );
}

/* The projects of this machine in the order of the project menu, the one this window shows first. */
function useOutlineSources(endpointId: string): OutlineSource[] {
    const rows = useProjectList((s) => s.projects);
    const endpoints = useEndpoints((s) => s.endpoints);
    const current = useProject((s) => s.current);
    const views = useDocument((s) => s.views);
    const shared = useDocument((s) => s.shared);
    const machines = useSidebarMachines(true, [endpointId], false);
    const here = rows.filter((row) => row.endpointId === endpointId);
    const menu = [...menuProjects(here, endpoints, []).open, ...chatsProjects(here, endpoints, [])].map((row) => row.summary);
    const listed = current === null ? menu : [current, ...menu.filter((summary) => summary.projectId !== current.projectId)];
    const snapshot = machines[endpointId];

    return listed.map((summary) => {
        if (summary.projectId === current?.projectId) {
            // What the editors hold, so a node added since the last save has its row already.
            const live = views.map((entry) => (isCanvasView(entry) ? { ...entry, nodes: [...nodesOfView(entry)] } : entry));
            return { summary, views: projectSidebarViews(live, shared ?? []) };
        }

        return { summary, views: snapshot?.projects.find((project) => project.summary.projectId === summary.projectId)?.views ?? null };
    });
}

function Values({ totals }: { totals: Totals }) {
    const values = [formatPercent(totals.cpu), formatBytes(totals.memory), formatRate(totals.disk)];
    return (
        <>
            {values.map((value, at) => (
                <span key={COLUMN_WIDTHS[at]} className={clsx(VALUES, COLUMN_WIDTHS[at])}>
                    {value}
                </span>
            ))}
        </>
    );
}

function NodeGlyph({ glyph }: { glyph: OutlineNode['glyph'] }) {
    if ('group' in glyph) {
        return <Icon icon={GROUP_ICONS[glyph.group]} size={14} />;
    }

    const { node } = glyph;

    if (node.provider !== null && (node.kind === 'chat' || node.kind === 'terminal')) {
        return <AgentIcon kind={node.provider} size={14} />;
    }

    return <Icon icon={NODE_KIND_ICONS[node.kind]} size={14} />;
}

/*
 * A row with something under it, which a click anywhere on it folds, as a project heading in the sidebar.
 * Its mark gives way to the chevron under the pointer; a row with nothing under it keeps its mark.
 */
function FoldRow({
    open,
    foldable,
    level,
    glyph,
    className,
    onToggle,
    children
}: {
    open: boolean;
    foldable: boolean;
    level: number;
    glyph: ReactNode;
    className?: string;
    onToggle(): void;
    children: ReactNode;
}) {
    return (
        <ListRow
            variant="inset"
            indent={level}
            render={<button type="button" />}
            aria-expanded={foldable ? open : undefined}
            className={clsx(ROW, 'w-full text-left focus-visible:outline-2 focus-visible:outline-accent-on-surface', className)}
            onClick={foldable ? onToggle : undefined}
        >
            <span className={ICON_SLOT}>
                <span className={clsx('col-start-1 row-start-1 grid place-items-center', foldable && 'group-hover:hidden group-focus-visible:hidden')}>
                    {glyph}
                </span>
                {foldable && (
                    <Icon
                        icon={ChevronRight}
                        size={14}
                        className={clsx('col-start-1 row-start-1 hidden group-hover:block group-focus-visible:block', open && 'rotate-90')}
                    />
                )}
            </span>
            {children}
        </ListRow>
    );
}

function WarningMark() {
    return <Icon icon={TriangleAlert} size={12} className="shrink-0 text-status-needs-you" />;
}

function SignalMenu({ target, onSignal, onForce }: { target: Target; onSignal(target: Target, signal: ProcessSignal): void; onForce(target: Target): void }) {
    const { t } = useTranslation('panels');
    return (
        <ContextMenu.Popup>
            <Menu.Label>
                {target.name} ({target.pid})
            </Menu.Label>
            <ContextMenu.Item onClick={() => onSignal(target, 'SIGINT')}>
                <Icon icon={Pause} size={14} /> {t('processes.signal.interrupt')} <Menu.Hint>SIGINT</Menu.Hint>
            </ContextMenu.Item>
            <ContextMenu.Item onClick={() => onSignal(target, 'SIGTERM')}>
                <Icon icon={CircleStop} size={14} /> {t('processes.signal.terminate')} <Menu.Hint>SIGTERM</Menu.Hint>
            </ContextMenu.Item>
            <ContextMenu.Item className="text-status-error" onClick={() => onForce(target)}>
                <Icon icon={OctagonX} size={14} /> {t('processes.signal.forceQuit')} <Menu.Hint>SIGKILL</Menu.Hint>
            </ContextMenu.Item>
        </ContextMenu.Popup>
    );
}

function AlertLine({
    alert,
    now,
    inset,
    onAction,
    onDismiss
}: {
    alert: ProcessAlert;
    now: number;
    inset: number;
    onAction(action: AlertAction): void;
    onDismiss(): void;
}) {
    const { t } = useTranslation('common');
    return (
        <div className="my-1 mr-2 flex flex-col gap-1.5 rounded-md border border-border bg-surface-sunken py-2 pr-2 pl-3" style={{ marginInlineStart: inset }}>
            <div className="flex items-start gap-1.5">
                <Icon icon={TriangleAlert} size={12} className="mt-1 shrink-0 text-status-needs-you" />
                <p className="grow text-xs text-text">{alertText(alert, now)}</p>
                <IconButton icon={X} size="xs" label={t('action.dismiss')} className="-my-1" onClick={onDismiss} />
            </div>
            <div className="flex flex-wrap gap-1.5 pl-[18px]">
                {alertActions(alert).map((action) => (
                    <Button key={action} size="sm" variant="secondary" onClick={() => onAction(action)}>
                        {actionLabel(action)}
                    </Button>
                ))}
            </div>
        </div>
    );
}

/* The keys of the rows above a group, outermost first, so a warning can open the way down to it. */
function pathTo(projects: readonly OutlineProject[], groupId: string): string[] {
    for (const project of projects) {
        for (const item of project.items) {
            const nodes = item.kind === 'view' ? item.nodes : [item];
            const node = nodes.find((entry) => entry.groups.some((group) => group.id === groupId));

            if (node !== undefined) {
                return [projectKey(project), ...(item.kind === 'view' ? [`view:${item.id}`] : []), `node:${node.id}`];
            }
        }
    }

    return [];
}

function projectKey(project: OutlineProject): string {
    return `project:${project.projectId ?? 'ruimte'}`;
}

/*
 * What runs on the machine of this workspace: the machine's CPU, memory and disk as bars of Ruimte's
 * projects, then those projects with their views, nodes and processes in the order of the sidebar.
 * Every signal goes through the daemon, which checks that the pid still names the process this row showed.
 */
export function ProcessesPanel() {
    const { t } = useTranslation(['panels', 'processes']);
    useProcessesFeed();
    const endpointId = useEndpointId();
    const connection = useEndpointConnection(endpointId);
    const machineName = useEndpoints((s) => s.endpoints.find((entry) => entry.id === endpointId)?.label ?? null);
    const row = useProcesses((s) => s.byEndpoint[endpointId] ?? EMPTY_PROCESSES);
    const alerts = useProcessAlerts(endpointId);
    const sources = useOutlineSources(endpointId);
    const nodes = useProjectNodes();
    const [toggled, setToggled] = useState<ReadonlySet<string>>(new Set());
    const [highlight, setHighlight] = useState<Target | null>(null);
    const [forcing, setForcing] = useState<Target | null>(null);

    const header = <PanelHeaderSlot>{machineName !== null && <span className="min-w-0 truncate text-xs text-text-muted">{machineName}</span>}</PanelHeaderSlot>;

    if (row.supported === false) {
        return (
            <PanelEmpty header={header} icon={Activity}>
                {t('processes.unsupported')}
            </PanelEmpty>
        );
    }

    if (connection.status !== 'open') {
        return (
            <PanelEmpty header={header} icon={Activity}>
                {t('machineNotAnswering')}
            </PanelEmpty>
        );
    }

    const sample = row.sample;

    if (sample === null) {
        return (
            <PanelEmpty header={header} icon={Activity}>
                {t('processes.measuring')}
            </PanelEmpty>
        );
    }

    const now = sample.at;
    const titles = new Map(nodes.map((node) => [node.id, node.title]));
    const groups = sample.groups;
    const projects = processOutline(groups, sources, titles);
    const series = chartSeries(row.fine, row.coarse);
    const diskScale = niceScale(Math.max(1, diskOf(sample.machine) ?? 0, ...series.points.map((point) => point.disk ?? 0))).max;
    // A node is folded until a person opens it; a project and a view are open until a person folds them.
    const isOpen = (key: string): boolean => (key.startsWith('node:') ? toggled.has(key) : !toggled.has(key));
    const toggle = (key: string): void => setToggled(toggled.has(key) ? new Set([...toggled].filter((entry) => entry !== key)) : new Set([...toggled, key]));
    const placed = new Map<string, ProcessAlert[]>();
    const loose: ProcessAlert[] = [];

    for (const alert of alerts) {
        const place = alertPlacement(alert, groups);

        if (place === null) {
            loose.push(alert);
        } else {
            placed.set(place, [...(placed.get(place) ?? []), alert]);
        }
    }

    const alertsOf = (node: OutlineNode): ProcessAlert[] => node.groups.flatMap((group) => placed.get(group.id) ?? []);
    const warns = (nodes: readonly OutlineNode[]): boolean => nodes.some((node) => alertsOf(node).length > 0);

    const fail = (title: string, e: unknown): void => {
        useToasts.getState().show({ title, description: messageOf(e), kind: 'error' });
    };

    /* SIGKILL only comes here after the force dialog, which is the person's answer to the action's question. */
    const signal = (target: Target, kind: ProcessSignal): void => {
        perform('process.signal', { pid: target.pid, startTime: target.startTime, name: target.name, signal: kind }, { confirmed: true }).catch((e: unknown) =>
            fail(t('processes.signalFailed', { name: target.name }), e)
        );
    };

    const act = (alert: ProcessAlert, action: AlertAction): void => {
        const target =
            alert.pid !== null && alert.startTime !== null
                ? { pid: alert.pid, startTime: alert.startTime, name: alert.name ?? t('processes.theProcess') }
                : null;

        if (action === 'show') {
            const place = alertPlacement(alert, groups);
            const closed = place === null ? [] : pathTo(projects, place).filter((key) => !isOpen(key));

            if (closed.length > 0) {
                setToggled(new Set([...toggled].filter((key) => !closed.includes(key)).concat(closed.filter((key) => key.startsWith('node:')))));
            }

            setHighlight(target);
            return;
        }

        if (action === 'resume' && alert.nodeId !== null) {
            perform('terminal.resumeAgent', { terminalId: alert.nodeId }).catch((e: unknown) => fail(t('processes.resumeFailed'), e));
            return;
        }

        const chat = alert.nodeId !== null && groups.some((group) => group.kind === 'chat' && group.nodeId === alert.nodeId);

        if (action === 'interrupt' && chat) {
            // A chat has a turn to cancel, which is the interrupt its CLI understands.
            perform('chat.stopTurn', { chatId: alert.nodeId!, subagents: false }).catch((e: unknown) => fail(t('processes.interruptFailed'), e));
            return;
        }

        if (target !== null) {
            signal(target, action === 'interrupt' ? 'SIGINT' : 'SIGTERM');
        }
    };

    const dismiss = (alert: ProcessAlert): void => {
        void perform('process.dismissAlert', { alertId: alert.id }).catch(ignoreRefusal);
    };

    const processRows = (node: OutlineNode, level: number) =>
        node.groups.flatMap((group) =>
            group.processes.map((process) => {
                const line = (
                    <ListRow
                        variant="inset"
                        className={clsx(
                            'group h-7 gap-2 text-xs text-text-muted hover:bg-surface-hover hover:text-text',
                            highlight?.pid === process.pid && highlight.startTime === process.startTime && 'bg-surface-active text-text'
                        )}
                        style={{ paddingInlineStart: ROW_START + level * LEVEL + process.depth * DEPTH_STEP }}
                    >
                        <span className={clsx('min-w-0 truncate', !process.readable && 'text-text-faint')}>{process.name}</span>
                        <span className="shrink-0 text-text-faint tabular-nums">{process.pid}</span>
                        {process.family !== null && <span className="shrink-0 text-text-faint">{process.family}</span>}
                        <span className="grow" />
                        <Values totals={{ cpu: process.cpu, memory: process.memory, disk: diskOf(process) }} />
                    </ListRow>
                );
                const key = `${process.pid}:${process.startTime}`;

                return signalable(process) ? (
                    <ContextMenu.Root key={key}>
                        <ContextMenu.Trigger render={<div />}>{line}</ContextMenu.Trigger>
                        <SignalMenu target={process} onSignal={signal} onForce={setForcing} />
                    </ContextMenu.Root>
                ) : (
                    <div key={key}>{line}</div>
                );
            })
        );

    const nodeBlock = (node: OutlineNode, level: number) => {
        const key = `node:${node.id}`;
        const open = isOpen(key);
        const here = alertsOf(node);
        const root = node.groups[0]?.processes[0];
        const kind = node.groups[0]?.kind;
        const nodeRow = (
            <FoldRow
                open={open}
                foldable={node.groups.some((group) => group.processes.length > 0)}
                level={level}
                glyph={<NodeGlyph glyph={node.glyph} />}
                onToggle={() => toggle(key)}
            >
                <span className="min-w-0 truncate">{node.title}</span>
                {here.length > 0 && <WarningMark />}
                <span className="grow" />
                <Values totals={node.totals} />
            </FoldRow>
        );

        return (
            <div key={key}>
                {root !== undefined && signalable(root) && (kind === 'terminal' || kind === 'chat') ? (
                    <ContextMenu.Root>
                        <ContextMenu.Trigger render={<div />}>{nodeRow}</ContextMenu.Trigger>
                        <SignalMenu target={root} onSignal={signal} onForce={setForcing} />
                    </ContextMenu.Root>
                ) : (
                    nodeRow
                )}
                {here.map((alert) => (
                    <AlertLine
                        key={alert.id}
                        alert={alert}
                        now={now}
                        inset={ROW_START + level * LEVEL}
                        onAction={(action) => act(alert, action)}
                        onDismiss={() => dismiss(alert)}
                    />
                ))}
                {open && processRows(node, level + 1)}
            </div>
        );
    };

    const viewBlock = (item: OutlineView) => {
        const key = `view:${item.id}`;
        const open = isOpen(key);
        const { view } = item;

        return (
            <div key={key}>
                <FoldRow
                    open={open}
                    foldable
                    level={1}
                    glyph={
                        <ViewGlyph id={view.id} kind={view.design === true ? 'design' : view.kind} icon={view.icon} provider={view.provider} path={view.path} />
                    }
                    onToggle={() => toggle(key)}
                >
                    <span className="min-w-0 truncate">{view.name}</span>
                    {!open && warns(item.nodes) && <WarningMark />}
                    <span className="grow" />
                    <Values totals={item.totals} />
                </FoldRow>
                {open && item.nodes.map((node) => nodeBlock(node, 2))}
            </div>
        );
    };

    const projectBlock = (project: OutlineProject) => {
        const key = projectKey(project);
        const open = isOpen(key);
        const name = project.summary?.name ?? t('processes.ruimteItself');
        const nodesOf = project.items.flatMap((item) => (item.kind === 'view' ? item.nodes : [item]));

        return (
            <div key={key} className="not-first:mt-1.5">
                <FoldRow
                    open={open}
                    foldable
                    level={0}
                    className="font-medium text-text"
                    glyph={
                        project.summary === null ? (
                            <RuimteMark size={14} />
                        ) : (
                            <ProjectGlyph
                                projectId={project.summary.projectId}
                                endpointId={endpointId}
                                icon={project.summary.icon}
                                color={project.summary.color}
                                size={14}
                                scratch={project.summary.scratch === true}
                            />
                        )
                    }
                    onToggle={() => toggle(key)}
                >
                    <span className="min-w-0 truncate">{name}</span>
                    {!open && warns(nodesOf) && <WarningMark />}
                    <span className="grow" />
                    <span className="contents font-normal">
                        <Values totals={project.totals} />
                    </span>
                </FoldRow>
                {open && project.items.map((item) => (item.kind === 'view' ? viewBlock(item) : nodeBlock(item, 1)))}
            </div>
        );
    };

    return (
        <div className="flex min-h-0 min-w-0 grow flex-col">
            {header}
            <ProcessBars projects={projects} machine={sample.machine} endpointId={endpointId} diskScale={diskScale} />
            <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-4">
                <span className="grow" />
                {(['cpu', 'memory', 'disk'] as const).map((column, at) => (
                    <SectionLabel key={column} className={clsx('shrink-0 text-right', COLUMN_WIDTHS[at])}>
                        {t(`processes.column.${column}`)}
                    </SectionLabel>
                ))}
            </div>
            <ScrollArea className="grow">
                {loose.map((alert) => (
                    <AlertLine
                        key={alert.id}
                        alert={alert}
                        now={now}
                        inset={ROW_START}
                        onAction={(action) => act(alert, action)}
                        onDismiss={() => dismiss(alert)}
                    />
                ))}
                <div className="px-2 py-1.5">{projects.map(projectBlock)}</div>
            </ScrollArea>

            <PromptDialog
                open={forcing !== null}
                title={t('processes.force.title', { name: forcing?.name })}
                description={t('processes.force.description', { pid: forcing?.pid })}
                confirmLabel={t('processes.force.confirm')}
                confirmIcon={OctagonX}
                danger
                onConfirm={() => {
                    if (forcing !== null) {
                        signal(forcing, 'SIGKILL');
                    }
                    setForcing(null);
                }}
                onOpenChange={() => setForcing(null)}
            />
        </div>
    );
}
