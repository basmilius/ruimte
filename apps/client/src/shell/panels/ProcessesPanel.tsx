import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { ContextMenu } from '@base-ui-components/react/context-menu';
import { Dialog } from '@base-ui-components/react/dialog';
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
import type { ProcessAlert, ProcessGroup, ProcessGroupKind, ProcessRow, ProcessSignal, ProcessSort } from '@ruimte/contracts';
import {
    ACTION_LABELS,
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
import { EmptyState } from '@/ui/EmptyState';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';

const SCOPES = [
    { id: 'ruimte', label: 'Ruimte' },
    { id: 'all', label: 'All' }
] as const;

const COLUMNS: readonly { sort: ProcessSort; label: string; width: string }[] = [
    { sort: 'cpu', label: 'CPU', width: 'w-12' },
    { sort: 'memory', label: 'Memory', width: 'w-16' },
    { sort: 'disk', label: 'Disk', width: 'w-16' }
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
    return (
        <ContextMenu.Portal>
            <ContextMenu.Positioner className="z-[var(--z-popup)]">
                <ContextMenu.Popup className="menu-popup">
                    <div className={MENU_LABEL}>
                        {target.name} ({target.pid})
                    </div>
                    <ContextMenu.Item className="menu-item" onClick={() => onSignal(target, 'SIGINT')}>
                        <Icon icon={Pause} size={14} /> Interrupt <span className={MENU_HINT}>SIGINT</span>
                    </ContextMenu.Item>
                    <ContextMenu.Item className="menu-item" onClick={() => onSignal(target, 'SIGTERM')}>
                        <Icon icon={CircleStop} size={14} /> Terminate <span className={MENU_HINT}>SIGTERM</span>
                    </ContextMenu.Item>
                    <ContextMenu.Item className="menu-item text-status-error" onClick={() => onForce(target)}>
                        <Icon icon={OctagonX} size={14} /> Force quit... <span className={MENU_HINT}>SIGKILL</span>
                    </ContextMenu.Item>
                </ContextMenu.Popup>
            </ContextMenu.Positioner>
        </ContextMenu.Portal>
    );
}

function AlertLine({ alert, now, onAction, onDismiss }: { alert: ProcessAlert; now: number; onAction(action: AlertAction): void; onDismiss(): void }) {
    return (
        <div className="flex flex-col gap-1.5 border-b border-border bg-surface-sunken py-2 pr-2 pl-3">
            <div className="flex items-start gap-1.5">
                <Icon icon={TriangleAlert} size={12} className="mt-0.5 text-status-needs-you" />
                <p className="grow text-xs text-text">{alertText(alert, now)}</p>
                <Tooltip label="Dismiss" name>
                    <button className="icon-btn -my-1 h-6 w-6 shrink-0" onClick={onDismiss}>
                        <Icon icon={X} size={12} />
                    </button>
                </Tooltip>
            </div>
            <div className="flex flex-wrap gap-1.5 pl-[18px]">
                {alertActions(alert).map((action) => (
                    <Button key={action} size="sm" variant="secondary" onClick={() => onAction(action)}>
                        {ACTION_LABELS[action]}
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

    const header = (
        <PanelHeaderSlot>
            {machineName !== null && <span className="min-w-0 truncate text-xs text-text-muted">{machineName}</span>}
            <span className="grow" />
            <Segmented value={scope} options={SCOPES} label="Which processes" onChange={(next) => useProcesses.getState().setScope(next)} />
        </PanelHeaderSlot>
    );

    if (platform === 'win32' || row.supported === false) {
        return (
            <div className="grid grow place-items-center">
                {header}
                <EmptyState icon={<Icon icon={Activity} size={20} />}>
                    {platform === 'win32'
                        ? 'Ruimte cannot measure processes on Windows yet, so there is nothing to show for this machine.'
                        : 'Ruimte cannot measure processes on the platform of this machine yet.'}
                </EmptyState>
            </div>
        );
    }
    if (connection.status !== 'open') {
        return (
            <div className="grid grow place-items-center">
                {header}
                <EmptyState icon={<Icon icon={Activity} size={20} />}>This machine is not answering, so its processes cannot be measured.</EmptyState>
            </div>
        );
    }
    const sample = row.sample;
    if (sample === null) {
        return (
            <div className="grid grow place-items-center">
                {header}
                <EmptyState icon={<Icon icon={Activity} size={20} />}>Measuring the processes on this machine...</EmptyState>
            </div>
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
        useToasts.getState().show({ title, description: e instanceof Error ? e.message : String(e), kind: 'error' });
    };
    const signal = (target: Target, kind: ProcessSignal): void => {
        transport
            .request('processes.signal', { pid: target.pid, startTime: target.startTime, signal: kind })
            .catch((e: unknown) => fail(`${target.name} was not signaled`, e));
    };
    const act = (alert: ProcessAlert, action: AlertAction): void => {
        const target =
            alert.pid !== null && alert.startTime !== null ? { pid: alert.pid, startTime: alert.startTime, name: alert.name ?? 'The process' } : null;
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
            transport.request('agent.resume', { sessionId: alert.nodeId }).catch((e: unknown) => fail('The agent could not be resumed', e));
            return;
        }
        const chat = alert.nodeId !== null && groups.some((group) => group.kind === 'chat' && group.nodeId === alert.nodeId);
        if (action === 'interrupt' && chat) {
            // A chat has a turn to cancel, which is the interrupt its CLI understands.
            transport.request('chat.cancel', { chatId: alert.nodeId! }).catch((e: unknown) => fail('The turn could not be interrupted', e));
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
                        This machine
                    </span>
                    <span className="flex items-center gap-1.5">
                        <span className="h-2 w-3 rounded-sm bg-accent/30" />
                        Ruimte
                    </span>
                    <span className="grow" />
                    {series.fine ? 'Last 10 minutes' : 'Last 24 hours'}
                </div>
                <ProcessChart
                    label="CPU"
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
                    label="Memory"
                    headline={`${formatBytes(machine.memoryUsed)} of ${formatBytes(machine.memoryTotal)}`}
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
                            label={`The sum of every process this machine lets Ruimte read.${machine.diskFree === null ? '' : ` ${formatBytes(machine.diskFree)} free.`}`}
                        >
                            <span>Disk</span>
                        </Tooltip>
                    }
                    headline={`Read ${formatRate(machine.diskRead)}, write ${formatRate(machine.diskWrite)}`}
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
                <span className={clsx(SECTION_LABEL, 'grow')}>Node</span>
                {COLUMNS.map((column) => (
                    <button
                        key={column.sort}
                        aria-pressed={sort === column.sort}
                        className={clsx(SECTION_LABEL, column.width, 'shrink-0 text-right hover:text-text', sort === column.sort && 'text-text')}
                        onClick={() => useProcesses.getState().setSort(column.sort)}
                    >
                        {column.label}
                    </button>
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
                                aria-label={open ? `Collapse ${title}` : `Expand ${title}`}
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
                            {!known && <span className="min-w-0 shrink truncate text-xs text-text-faint">another project</span>}
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
                                            <Tooltip label={process.path ?? process.name}>
                                                <span className={clsx('min-w-0 truncate text-xs', process.readable ? 'text-text' : 'text-text-faint')}>
                                                    {process.name}
                                                </span>
                                            </Tooltip>
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

            <Dialog.Root open={forcing !== null} onOpenChange={(next) => !next && setForcing(null)}>
                <Dialog.Portal>
                    <Dialog.Backdrop className="dialog-backdrop" />
                    <Dialog.Popup className="dialog-popup w-[420px] p-5">
                        <Dialog.Title className="text-base font-semibold text-text">Force quit {forcing?.name}?</Dialog.Title>
                        <p className="mt-1 text-xs text-text-muted">
                            SIGKILL ends process {forcing?.pid} at once, without a chance to save or clean up. Whatever it was writing may be left half done.
                        </p>
                        <div className="mt-4 flex items-center justify-end gap-2">
                            <Button onClick={() => setForcing(null)}>Cancel</Button>
                            <Button
                                variant="danger"
                                onClick={() => {
                                    if (forcing !== null) {
                                        signal(forcing, 'SIGKILL');
                                    }
                                    setForcing(null);
                                }}
                            >
                                <Icon icon={OctagonX} size={12} /> Force quit
                            </Button>
                        </div>
                    </Dialog.Popup>
                </Dialog.Portal>
            </Dialog.Root>
        </div>
    );
}
