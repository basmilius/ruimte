import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import {
    Activity,
    AppWindow,
    ArrowDown,
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
import type { ProcessAlert, ProcessGroup, ProcessGroupKind, ProcessRow, ProcessSignal, ProcessSort } from '@ruimte/contracts';
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
    groupTitle,
    type AlertAction
} from '@/processes/format';
import { ignoreRefusal, perform } from '@/actions/client-actions';
import { messageOf, Segmented, Button, Icon, IconButton, ListRow, Menu, Tooltip, PanelEmpty, PromptDialog, SectionLabel, ContextMenu } from '@adecore/ui';
import { useProjectNodes } from '@/project/view-nodes';
import { revealNode } from '@/project/views';
import { PanelHeaderActions, PanelHeaderSlot } from '@/shell/PanelHeaderSlot';
import { ProcessChart } from '@/shell/panels/ProcessChart';
import { niceScale } from '@adecore/agents-react/usage';
import { useEndpoints } from '@/state/endpoints';
import { useEndpointId } from '@/state/keys';
import { useProjectList } from '@/state/project-list';
import { EMPTY_PROCESSES, useProcessAlerts, useProcesses } from '@/state/processes';
import { useToasts } from '@/state/toasts';
import { useTransport } from '@/transport/context';
import { useEndpointConnection } from '@/transport/status';

/* The two scopes and the three sortable columns as ids; their words come from `panels:processes`. */
const SCOPES = ['ruimte', 'all'] as const;

const COLUMNS: readonly { sort: ProcessSort; width: string }[] = [
    { sort: 'cpu', width: 'w-12' },
    { sort: 'memory', width: 'w-16' },
    { sort: 'disk', width: 'w-16' }
];

const GROUP_ICONS: Record<ProcessGroupKind, LucideIcon> = { terminal: Terminal, chat: MessageSquare, app: AppWindow, daemon: Server, other: Cpu };

/* Whole pixels per level of a process under its node, past the chevron and the icon of the row above. */
const INDENT_BASE = 36;
const INDENT_STEP = 12;

const ROW_NUMBERS = 'shrink-0 text-right text-xs tabular-nums text-text-muted';

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
 * daemon, so a socket that comes back asks again, and a change of scope or sort is a fresh ask.
 */
function useProcessesFeed(): void {
    const transport = useTransport();
    const endpointId = useEndpointId();
    const scope = useProcesses((s) => s.scope);
    const sort = useProcesses((s) => s.sort);

    useEffect(() => {
        const subscribe = (): void => {
            transport
                .request('processes.subscribe', { scope, sort })
                .then((result) => useProcesses.getState().receive(endpointId, result))
                .catch(() => undefined);
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
            const current = useProcesses.getState();
            useProcesses.getState().applySample(endpointId, sample, sample.scope === current.scope);
        });
        return () => {
            offStatus();
            offSample();
        };
    }, [transport, endpointId, scope, sort]);

    useEffect(
        () => () => {
            void transport.request('processes.unsubscribe', {}).catch(() => undefined);
        },
        [transport]
    );
}

function Numbers({ row }: { row: { cpu: number | null; memory: number | null; diskRead: number | null; diskWrite: number | null } }) {
    return (
        <>
            <span className={clsx(ROW_NUMBERS, 'w-12')}>{formatPercent(row.cpu)}</span>
            <span className={clsx(ROW_NUMBERS, 'w-16')}>{formatBytes(row.memory)}</span>
            <span className={clsx(ROW_NUMBERS, 'w-16')}>{formatRate(diskOf(row))}</span>
        </>
    );
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

function AlertLine({ alert, now, onAction, onDismiss }: { alert: ProcessAlert; now: number; onAction(action: AlertAction): void; onDismiss(): void }) {
    const { t } = useTranslation('common');
    return (
        <div className="flex flex-col gap-1.5 border-b border-border bg-surface-sunken py-2 pr-2 pl-3">
            <div className="flex items-start gap-1.5">
                <Icon icon={TriangleAlert} size={12} className="mt-0.5 text-status-needs-you" />
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

/*
 * What runs on the machine of this workspace: charts of the machine against Ruimte's share, then a row
 * per node with its processes. Every signal goes through the daemon, which checks that the pid still
 * names the process this row showed.
 */
export function ProcessesPanel() {
    const { t } = useTranslation('panels');
    useProcessesFeed();
    const endpointId = useEndpointId();
    const connection = useEndpointConnection(endpointId);
    const machineName = useEndpoints((s) => s.endpoints.find((entry) => entry.id === endpointId)?.label ?? null);
    const scope = useProcesses((s) => s.scope);
    const sort = useProcesses((s) => s.sort);
    const row = useProcesses((s) => s.byEndpoint[endpointId] ?? EMPTY_PROCESSES);
    const alerts = useProcessAlerts(endpointId);
    const projectRows = useProjectList((s) => s.projects);
    const projectNames = new Map(projectRows.filter((entry) => entry.endpointId === endpointId).map((entry) => [entry.summary.projectId, entry.summary.name]));
    const nodes = useProjectNodes();
    const [toggled, setToggled] = useState<ReadonlySet<string>>(new Set());
    const [highlight, setHighlight] = useState<Target | null>(null);
    const [forcing, setForcing] = useState<Target | null>(null);
    const scopes = SCOPES.map((id) => ({ id, label: id === 'ruimte' ? 'Ruimte' : t('processes.scope.all') }));

    const header = (
        <PanelHeaderSlot>
            {machineName !== null && <span className="min-w-0 truncate text-xs text-text-muted">{machineName}</span>}
            <PanelHeaderActions>
                <Segmented value={scope} options={scopes} label={t('processes.scopeLabel')} onValueChange={(next) => useProcesses.getState().setScope(next)} />
            </PanelHeaderActions>
        </PanelHeaderSlot>
    );

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
    const series = chartSeries(row.fine, row.coarse);
    const span = { points: series.points, windowMs: series.windowMs, end: now };
    const { machine } = sample;
    const diskMax = niceScale(Math.max(1, ...series.points.map((point) => point.disk ?? 0))).max;
    const isOpen = (group: ProcessGroup): boolean => (group.kind === 'other' ? !toggled.has(group.id) : toggled.has(group.id));
    const toggle = (id: string): void => setToggled(toggled.has(id) ? new Set([...toggled].filter((entry) => entry !== id)) : new Set([...toggled, id]));
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
            const group = groups.find((entry) => entry.id === place);
            if (group !== undefined && !isOpen(group)) {
                toggle(group.id);
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

    return (
        <div className="flex min-h-0 min-w-0 grow flex-col">
            {header}
            <div className="flex shrink-0 flex-col gap-3 border-b border-border p-3">
                <div className="flex items-center gap-3 text-xs text-text-faint">
                    <span className="flex items-center gap-1.5">
                        <span className="h-px w-3 bg-text-muted" />
                        {t('processes.legend.machine')}
                    </span>
                    <span className="flex items-center gap-1.5">
                        <span className="h-2 w-3 rounded-sm bg-accent/30" />
                        Ruimte
                    </span>
                    <span className="grow" />
                    {series.fine ? t('processes.range.fine') : t('processes.range.coarse')}
                </div>
                <ProcessChart
                    label={t('processes.column.cpu')}
                    name={t('processes.chart', { measure: t('processes.column.cpu') })}
                    headline={formatPercent(machine.cpu)}
                    {...span}
                    max={100}
                    machine={(point) => point.cpu}
                    ruimte={(point) => point.cpuRuimte}
                    format={formatPercent}
                />
                <ProcessChart
                    label={t('processes.column.memory')}
                    name={t('processes.chart', { measure: t('processes.column.memory') })}
                    headline={t('processes.memoryHeadline', { used: formatBytes(machine.memoryUsed), total: formatBytes(machine.memoryTotal) })}
                    {...span}
                    max={machine.memoryTotal}
                    machine={(point) => point.memory}
                    ruimte={(point) => point.memoryRuimte}
                    format={formatBytes}
                />
                <ProcessChart
                    label={
                        <Tooltip
                            label={`${t('processes.diskTooltip')}${machine.diskFree === null ? '' : ` ${t('processes.diskFree', { size: formatBytes(machine.diskFree) })}`}`}
                        >
                            <span>{t('processes.column.disk')}</span>
                        </Tooltip>
                    }
                    name={t('processes.chart', { measure: t('processes.column.disk') })}
                    headline={t('processes.diskHeadline', { read: formatRate(machine.diskRead), write: formatRate(machine.diskWrite) })}
                    {...span}
                    max={diskMax}
                    machine={(point) => point.disk}
                    ruimte={(point) => point.diskRuimte}
                    format={formatRate}
                />
            </div>
            <div className="flex h-8 shrink-0 items-center gap-1.5 border-b border-border pr-3 pl-3">
                <SectionLabel className="grow">{t('processes.column.node')}</SectionLabel>
                {COLUMNS.map((column) => (
                    <Tooltip key={column.sort} label={t(`processes.sortBy.${column.sort}`)}>
                        <SectionLabel
                            render={<button type="button" />}
                            aria-pressed={sort === column.sort}
                            className={clsx(
                                column.width,
                                'group inline-flex shrink-0 items-center justify-end gap-0.5 hover:text-text',
                                sort === column.sort && 'text-text'
                            )}
                            onClick={() => useProcesses.getState().setSort(column.sort)}
                        >
                            {/* The sort only runs high to low, so one arrow is the whole state. On the
                                other columns it shows under the pointer to say they sort as well. */}
                            <Icon icon={ArrowDown} size={12} className={clsx('shrink-0', sort !== column.sort && 'opacity-0 group-hover:opacity-100')} />
                            {t(`processes.column.${column.sort}`)}
                        </SectionLabel>
                    </Tooltip>
                ))}
            </div>
            <div className="min-h-0 grow overflow-y-auto">
                {loose.map((alert) => (
                    <AlertLine key={alert.id} alert={alert} now={now} onAction={(action) => act(alert, action)} onDismiss={() => dismiss(alert)} />
                ))}
                {groups.map((group) => {
                    const open = isOpen(group);
                    const { title, known } = groupTitle(group, titles);
                    const root = group.processes[0];
                    const reveal = group.nodeId !== null && known && group.label === undefined ? group.nodeId : null;
                    const here = placed.get(group.id) ?? [];
                    const groupRow = (
                        <ListRow variant="flat" className="gap-1.5 pr-3 pl-1 hover:bg-surface-hover">
                            <IconButton
                                icon={ChevronRight}
                                size="xs"
                                iconClassName={clsx(open && 'rotate-90')}
                                label={open ? t('processes.collapse', { name: title }) : t('processes.expand', { name: title })}
                                tooltip={false}
                                aria-expanded={open}
                                onClick={() => toggle(group.id)}
                            />
                            <Icon icon={GROUP_ICONS[group.kind]} size={14} className="shrink-0 text-text-muted" />
                            {reveal !== null ? (
                                <button className="min-w-0 truncate text-left text-sm text-text hover:underline" onClick={() => revealNode(reveal)}>
                                    {title}
                                </button>
                            ) : (
                                <span className="min-w-0 truncate text-sm text-text">{title}</span>
                            )}
                            {!known && (
                                <span className="min-w-0 shrink truncate text-xs text-text-faint">
                                    {(group.projectId === undefined ? undefined : projectNames.get(group.projectId)) ?? t('processes.anotherProject')}
                                </span>
                            )}
                            {group.hidden > 0 && <span className="shrink-0 text-xs text-text-faint tabular-nums">+{group.hidden}</span>}
                            {here.length > 0 && <Icon icon={TriangleAlert} size={12} className="shrink-0 text-status-needs-you" />}
                            <span className="grow" />
                            <Numbers row={group} />
                        </ListRow>
                    );
                    return (
                        <div key={group.id} className="border-b border-border-soft">
                            {root !== undefined && signalable(root) && group.kind !== 'other' && group.kind !== 'daemon' && group.kind !== 'app' ? (
                                <ContextMenu.Root>
                                    <ContextMenu.Trigger render={<div />}>{groupRow}</ContextMenu.Trigger>
                                    <SignalMenu target={root} onSignal={signal} onForce={setForcing} />
                                </ContextMenu.Root>
                            ) : (
                                groupRow
                            )}
                            {here.map((alert) => (
                                <AlertLine key={alert.id} alert={alert} now={now} onAction={(action) => act(alert, action)} onDismiss={() => dismiss(alert)} />
                            ))}
                            {open &&
                                group.processes.map((process) => {
                                    const line = (
                                        <ListRow
                                            variant="flat"
                                            className={clsx(
                                                'gap-1.5 pr-3 hover:bg-surface-hover',
                                                highlight?.pid === process.pid && highlight.startTime === process.startTime && 'bg-surface-active'
                                            )}
                                            style={{ paddingLeft: INDENT_BASE + process.depth * INDENT_STEP }}
                                        >
                                            <span className={clsx('min-w-0 truncate text-xs', process.readable ? 'text-text' : 'text-text-faint')}>
                                                {process.name}
                                            </span>
                                            <span className="shrink-0 text-xs text-text-faint tabular-nums">{process.pid}</span>
                                            {process.family !== null && <span className="shrink-0 text-xs text-text-faint">{process.family}</span>}
                                            <span className="grow" />
                                            <Numbers row={process} />
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
                                })}
                        </div>
                    );
                })}
            </div>

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
