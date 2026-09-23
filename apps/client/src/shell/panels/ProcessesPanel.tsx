import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { ContextMenu } from '@base-ui-components/react/context-menu';
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
import { performAsPerson } from '@/actions/client-actions';
import { messageOf } from '@/pulsar/account';
import { projectNodes, revealNode } from '@/project/views';
import { Segmented } from '@/shell/settings/controls';
import { PanelHeaderSlot } from '@/shell/PanelHeaderSlot';
import { ProcessChart } from '@/shell/panels/ProcessChart';
import { niceScale } from '@/shell/usage/summary';
import { useCanvas } from '@/state/canvas';
import { useDocument } from '@/state/document';
import { useEndpoints } from '@/state/endpoints';
import { useEndpointId } from '@/state/keys';
import { EMPTY_PROCESSES, useProcessAlerts, useProcesses } from '@/state/processes';
import { useServer } from '@/state/server';
import { useToasts } from '@/state/toasts';
import { useTransport } from '@/transport/context';
import { useEndpointConnection } from '@/transport/status';
import { Button } from '@/ui/Button';
import { MENU_HINT, MENU_LABEL, SECTION_LABEL } from '@/ui/classes';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';
import { PanelEmpty } from '@/ui/PanelEmpty';
import { PromptDialog } from '@/ui/PromptDialog';

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
const signalable = (row: ProcessRow): boolean => row.readable && row.startTime !== 0;

/*
 * Keeps this client subscribed while the panel is on screen. The subscription is per socket on the
 * daemon, so a socket that comes back asks again, and a change of scope or sort is a fresh ask.
 */
const useProcessesFeed = (): void => {
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
};

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
        <ContextMenu.Portal>
            <ContextMenu.Positioner className="z-(--z-popup)">
                <ContextMenu.Popup className="menu-popup">
                    <div className={MENU_LABEL}>
                        {target.name} ({target.pid})
                    </div>
                    <ContextMenu.Item className="menu-item" onClick={() => onSignal(target, 'SIGINT')}>
                        <Icon icon={Pause} size={14} /> {t('processes.signal.interrupt')} <span className={MENU_HINT}>SIGINT</span>
                    </ContextMenu.Item>
                    <ContextMenu.Item className="menu-item" onClick={() => onSignal(target, 'SIGTERM')}>
                        <Icon icon={CircleStop} size={14} /> {t('processes.signal.terminate')} <span className={MENU_HINT}>SIGTERM</span>
                    </ContextMenu.Item>
                    <ContextMenu.Item className="menu-item text-status-error" onClick={() => onForce(target)}>
                        <Icon icon={OctagonX} size={14} /> {t('processes.signal.forceQuit')} <span className={MENU_HINT}>SIGKILL</span>
                    </ContextMenu.Item>
                </ContextMenu.Popup>
            </ContextMenu.Positioner>
        </ContextMenu.Portal>
    );
}

function AlertLine({ alert, now, onAction, onDismiss }: { alert: ProcessAlert; now: number; onAction(action: AlertAction): void; onDismiss(): void }) {
    const { t } = useTranslation('common');
    return (
        <div className="flex flex-col gap-1.5 border-b border-border bg-surface-sunken py-2 pr-2 pl-3">
            <div className="flex items-start gap-1.5">
                <Icon icon={TriangleAlert} size={12} className="mt-0.5 text-status-needs-you" />
                <p className="grow text-xs text-text">{alertText(alert, now)}</p>
                <Tooltip label={t('action.dismiss')} name>
                    <button className="icon-btn -my-1 h-6 w-6 shrink-0" onClick={onDismiss}>
                        <Icon icon={X} size={12} />
                    </button>
                </Tooltip>
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
 * What runs on the machine of this workspace: three charts of the machine against the share of
 * Ruimte, then a row per node with the processes under it. A warning sits on the row it is about,
 * with the button that fits; every signal goes through the daemon, which checks that the pid still
 * names the process this row showed.
 */
export function ProcessesPanel() {
    const { t } = useTranslation('panels');
    useProcessesFeed();
    const transport = useTransport();
    const endpointId = useEndpointId();
    const connection = useEndpointConnection(endpointId);
    const platform = useServer((s) => s.platform);
    const machineName = useEndpoints((s) => s.endpoints.find((entry) => entry.id === endpointId)?.label ?? null);
    const scope = useProcesses((s) => s.scope);
    const sort = useProcesses((s) => s.sort);
    const row = useProcesses((s) => s.byEndpoint[endpointId] ?? EMPTY_PROCESSES);
    const alerts = useProcessAlerts(endpointId);
    // Titles come from the project; these two subscriptions are what redraws a row after a rename.
    useDocument((s) => s.views);
    useCanvas((s) => s.nodes);
    const [toggled, setToggled] = useState<ReadonlySet<string>>(new Set());
    const [highlight, setHighlight] = useState<Target | null>(null);
    const [forcing, setForcing] = useState<Target | null>(null);
    const scopes = useMemo(() => SCOPES.map((id) => ({ id, label: id === 'ruimte' ? 'Ruimte' : t('processes.scope.all') })), [t]);

    const header = (
        <PanelHeaderSlot>
            {machineName !== null && <span className="min-w-0 truncate text-xs text-text-muted">{machineName}</span>}
            <span className="grow" />
            <Segmented value={scope} options={scopes} label={t('processes.scopeLabel')} onChange={(next) => useProcesses.getState().setScope(next)} />
        </PanelHeaderSlot>
    );

    if (platform === 'win32' || row.supported === false) {
        return (
            <PanelEmpty header={header} icon={Activity}>
                {platform === 'win32' ? t('processes.unsupportedWindows') : t('processes.unsupported')}
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
    const titles = new Map(projectNodes().map((node) => [node.id, node.title]));
    const groups = sample.groups;
    const series = chartSeries(row.fine, row.coarse);
    const { machine } = sample;
    const diskMax = niceScale(Math.max(1, ...series.points.map((point) => point.disk ?? 0))).max;
    const isOpen = (group: ProcessGroup): boolean => (group.kind === 'other' ? !toggled.has(group.id) : toggled.has(group.id));
    const toggle = (id: string): void => {
        const next = new Set(toggled);
        if (next.has(id)) {
            next.delete(id);
        } else {
            next.add(id);
        }
        setToggled(next);
    };
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
    const signal = (target: Target, kind: ProcessSignal): void => {
        transport
            .request('processes.signal', { pid: target.pid, startTime: target.startTime, signal: kind })
            .catch((e: unknown) => fail(t('processes.signalFailed', { name: target.name }), e));
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
            performAsPerson('terminal.resumeAgent', { terminalId: alert.nodeId }).catch((e: unknown) => fail(t('processes.resumeFailed'), e));
            return;
        }
        const chat = alert.nodeId !== null && groups.some((group) => group.kind === 'chat' && group.nodeId === alert.nodeId);
        if (action === 'interrupt' && chat) {
            // A chat has a turn to cancel, which is the interrupt its CLI understands.
            performAsPerson('chat.stopTurn', { chatId: alert.nodeId!, subagents: false }).catch((e: unknown) => fail(t('processes.interruptFailed'), e));
            return;
        }
        if (target !== null) {
            signal(target, action === 'interrupt' ? 'SIGINT' : 'SIGTERM');
        }
    };
    const dismiss = (alert: ProcessAlert): void => {
        transport.request('processes.dismiss', { id: alert.id }).catch(() => undefined);
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
                    headline={formatPercent(machine.cpu)}
                    points={series.points}
                    windowMs={series.windowMs}
                    end={now}
                    max={100}
                    machine={(point) => point.cpu}
                    ruimte={(point) => point.cpuRuimte}
                    format={(value) => formatPercent(value)}
                />
                <ProcessChart
                    label={t('processes.column.memory')}
                    headline={t('processes.memoryHeadline', { used: formatBytes(machine.memoryUsed), total: formatBytes(machine.memoryTotal) })}
                    points={series.points}
                    windowMs={series.windowMs}
                    end={now}
                    max={machine.memoryTotal}
                    machine={(point) => point.memory}
                    ruimte={(point) => point.memoryRuimte}
                    format={(value) => formatBytes(value)}
                />
                <ProcessChart
                    label={
                        <Tooltip
                            label={`${t('processes.diskTooltip')}${machine.diskFree === null ? '' : ` ${t('processes.diskFree', { size: formatBytes(machine.diskFree) })}`}`}
                        >
                            <span>{t('processes.column.disk')}</span>
                        </Tooltip>
                    }
                    headline={t('processes.diskHeadline', { read: formatRate(machine.diskRead), write: formatRate(machine.diskWrite) })}
                    points={series.points}
                    windowMs={series.windowMs}
                    end={now}
                    max={diskMax}
                    machine={(point) => point.disk}
                    ruimte={(point) => point.diskRuimte}
                    format={(value) => formatRate(value)}
                />
            </div>
            <div className="flex h-8 shrink-0 items-center gap-1.5 border-b border-border pr-3 pl-3">
                <span className={clsx(SECTION_LABEL, 'grow')}>{t('processes.column.node')}</span>
                {COLUMNS.map((column) => (
                    <Tooltip key={column.sort} label={t(`processes.sortBy.${column.sort}`)}>
                        <button
                            aria-pressed={sort === column.sort}
                            className={clsx(
                                SECTION_LABEL,
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
                        </button>
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
                    const reveal = group.nodeId !== null && known ? group.nodeId : null;
                    const here = placed.get(group.id) ?? [];
                    const groupRow = (
                        <div className="flex h-8 items-center gap-1.5 pr-3 pl-1 hover:bg-surface-hover">
                            <button
                                className="icon-btn h-6 w-6 shrink-0"
                                aria-expanded={open}
                                aria-label={open ? t('processes.collapse', { name: title }) : t('processes.expand', { name: title })}
                                onClick={() => toggle(group.id)}
                            >
                                <Icon icon={ChevronRight} size={14} className={clsx(open && 'rotate-90')} />
                            </button>
                            <Icon icon={GROUP_ICONS[group.kind]} size={14} className="shrink-0 text-text-muted" />
                            {reveal !== null ? (
                                <button className="min-w-0 truncate text-left text-sm text-text hover:underline" onClick={() => revealNode(reveal)}>
                                    {title}
                                </button>
                            ) : (
                                <span className="min-w-0 truncate text-sm text-text">{title}</span>
                            )}
                            {!known && <span className="min-w-0 shrink truncate text-xs text-text-faint">{t('processes.anotherProject')}</span>}
                            {group.hidden > 0 && <span className="shrink-0 text-xs text-text-faint tabular-nums">+{group.hidden}</span>}
                            {here.length > 0 && <Icon icon={TriangleAlert} size={12} className="shrink-0 text-status-needs-you" />}
                            <span className="grow" />
                            <Numbers row={group} />
                        </div>
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
                                        <div
                                            className={clsx(
                                                'flex h-7 items-center gap-1.5 pr-3 hover:bg-surface-hover',
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
                                        </div>
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
                onClose={() => setForcing(null)}
            />
        </div>
    );
}
