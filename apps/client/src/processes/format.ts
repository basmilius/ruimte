import type { ProcessAlert, ProcessGroup, ProcessPoint } from '@ruimte/contracts';

/* A number that could not be read is shown as nothing rather than as zero, which is what it is not. */
export const UNREADABLE = '-';

const ONE_DECIMAL = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const WHOLE = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

/* Percent as Activity Monitor writes it: a decimal under ten, where the difference still means something. */
export const formatPercent = (value: number | null): string => {
    if (value === null) {
        return UNREADABLE;
    }
    return `${value < 10 ? ONE_DECIMAL.format(value) : WHOLE.format(value)}%`;
};

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

export const formatBytes = (value: number | null): string => {
    if (value === null) {
        return UNREADABLE;
    }
    let size = value;
    let unit = 0;
    while (size >= 1024 && unit < UNITS.length - 1) {
        size /= 1024;
        unit++;
    }
    return `${size < 10 && unit > 0 ? ONE_DECIMAL.format(size) : WHOLE.format(size)} ${UNITS[unit]}`;
};

export const formatRate = (value: number | null): string => (value === null ? UNREADABLE : `${formatBytes(value)}/s`);

export const formatDuration = (ms: number): string => {
    const seconds = Math.max(0, Math.round(ms / 1000));
    if (seconds < 60) {
        return `${seconds} s`;
    }
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) {
        return `${minutes} min`;
    }
    return `${ONE_DECIMAL.format(minutes / 60)} h`;
};

/* Read and written together, which is what the disk column and its sort mean. */
export const diskOf = (row: { diskRead: number | null; diskWrite: number | null }): number | null =>
    row.diskRead === null && row.diskWrite === null ? null : (row.diskRead ?? 0) + (row.diskWrite ?? 0);

/*
 * Which series the charts draw: the fine one once it has a line to draw, the coarse day until then.
 * The window is what the x axis spans, so a fine series that has only just started still fills from
 * the right and does not stretch three points over the whole width.
 */
export const chartSeries = (fine: readonly ProcessPoint[], coarse: readonly ProcessPoint[], fineIntervalMs = 2000, coarseIntervalMs = 300_000) =>
    fine.length >= 2 ? { points: fine, windowMs: 300 * fineIntervalMs, fine: true } : { points: coarse, windowMs: 288 * coarseIntervalMs, fine: false };

const AGENT_NAMES: Record<string, string> = { claude: 'Claude Code', codex: 'Codex', gemini: 'Gemini', copilot: 'Copilot' };

export const agentName = (kind: string): string => AGENT_NAMES[kind] ?? kind.charAt(0).toUpperCase() + kind.slice(1);

/* The warning in one sentence a person reads without knowing what a hook is. */
export const alertText = (alert: ProcessAlert, now: number): string => {
    const name = alert.name ?? 'A process';
    switch (alert.kind) {
        case 'silent':
            return `Working, but silent for ${formatDuration(now - alert.since)}`;
        case 'busy-after-turn':
            return `${name} keeps using ${formatPercent(alert.value)} of a core after the turn ended`;
        case 'memory':
            return `${name} uses ${formatBytes(alert.value)}`;
        case 'agent-gone':
            return `${agentName(alert.name ?? 'The agent')} is gone, but its status still says it runs`;
        case 'orphan':
            return `${name} outlived its terminal`;
        case 'probe-hung':
            return `${name}, started by Ruimte, has run for ${formatDuration(now - alert.since)}`;
    }
};

export type AlertAction = 'interrupt' | 'terminate' | 'show' | 'resume';

/* The button that fits the signal. None of them does anything until a person presses it. */
export const alertActions = (alert: ProcessAlert): AlertAction[] => {
    switch (alert.kind) {
        case 'silent':
            return ['interrupt'];
        case 'busy-after-turn':
            return ['show', 'terminate'];
        case 'memory':
            return ['show'];
        case 'agent-gone':
            return ['resume'];
        case 'orphan':
        case 'probe-hung':
            return ['terminate'];
    }
};

export const ACTION_LABELS: Record<AlertAction, string> = { interrupt: 'Interrupt', terminate: 'Terminate', show: 'Show process', resume: 'Resume' };

const GROUP_TITLES: Record<ProcessGroup['kind'], string> = {
    terminal: 'Terminal',
    chat: 'Chat',
    app: 'Ruimte app',
    daemon: 'Machine tasks',
    other: 'Other processes'
};

/* What a group is called: the title of its node when this project has it, the kind otherwise. */
export const groupTitle = (group: ProcessGroup, titles: ReadonlyMap<string, string>): { title: string; known: boolean } => {
    const title = group.nodeId === null ? undefined : titles.get(group.nodeId);
    return title === undefined ? { title: GROUP_TITLES[group.kind], known: group.nodeId === null } : { title, known: true };
};

/* Where a warning is drawn: under the row of its node, under the row that holds its process, or above the list. */
export const alertPlacement = (alert: ProcessAlert, groups: readonly ProcessGroup[]): string | null => {
    const byNode = alert.nodeId === null ? undefined : groups.find((group) => group.nodeId === alert.nodeId);
    if (byNode !== undefined) {
        return byNode.id;
    }
    const byProcess =
        alert.pid === null ? undefined : groups.find((group) => group.processes.some((row) => row.pid === alert.pid && row.startTime === alert.startTime));
    return byProcess?.id ?? null;
};
