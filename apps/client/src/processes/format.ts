import i18next from 'i18next';
import type { ProcessAlert, ProcessGroup, ProcessPoint } from '@ruimte/contracts';
import { formatDuration, formatBytes as bytesOf, formatPercent as percentOf } from '@adecore/ui/format';

/* A number that could not be read is shown as nothing rather than as zero, which is what it is not. */
export const UNREADABLE = '-';

export function formatPercent(value: number | null): string {
    return value === null ? UNREADABLE : percentOf(value);
}

export function formatBytes(value: number | null): string {
    return value === null ? UNREADABLE : bytesOf(value);
}

export function formatRate(value: number | null): string {
    return value === null ? UNREADABLE : `${formatBytes(value)}/s`;
}

export { formatDuration };

/* Read and written together, which is what the disk column and its sort mean. */
export function diskOf(row: { diskRead: number | null; diskWrite: number | null }): number | null {
    return row.diskRead === null && row.diskWrite === null ? null : (row.diskRead ?? 0) + (row.diskWrite ?? 0);
}

/*
 * Which series the charts draw: the fine one once it has a line to draw, the coarse day until then.
 * The window is what the x axis spans, so a fine series that has only just started still fills from
 * the right and does not stretch three points over the whole width.
 */
export function chartSeries(fine: readonly ProcessPoint[], coarse: readonly ProcessPoint[], fineIntervalMs = 2000, coarseIntervalMs = 300_000) {
    return fine.length >= 2 ? { points: fine, windowMs: 300 * fineIntervalMs, fine: true } : { points: coarse, windowMs: 288 * coarseIntervalMs, fine: false };
}

const AGENT_NAMES: Record<string, string> = { claude: 'Claude Code', codex: 'Codex', gemini: 'Gemini', copilot: 'Copilot' };

export function agentName(kind: string): string {
    return AGENT_NAMES[kind] ?? kind.charAt(0).toUpperCase() + kind.slice(1);
}

/* The warning in one sentence a person reads without knowing what a hook is. */
export function alertText(alert: ProcessAlert, now: number): string {
    const name = alert.name ?? i18next.t('processes:alert.unnamedProcess');
    switch (alert.kind) {
        case 'silent':
            return i18next.t('processes:alert.silent', { elapsed: formatDuration(now - alert.since) });
        case 'busy-after-turn':
            return i18next.t('processes:alert.busyAfterTurn', { name, percent: formatPercent(alert.value) });
        case 'memory':
            return i18next.t('processes:alert.memory', { name, size: formatBytes(alert.value) });
        case 'agent-gone':
            return i18next.t('processes:alert.agentGone', { agent: agentName(alert.name ?? i18next.t('processes:alert.unnamedAgent')) });
        case 'orphan':
            return i18next.t('processes:alert.orphan', { name });
        case 'probe-hung':
            return i18next.t('processes:alert.probeHung', { name, elapsed: formatDuration(now - alert.since) });
    }
}

export type AlertAction = 'interrupt' | 'terminate' | 'show' | 'resume';

/* The button that fits the signal. None of them does anything until a person presses it. */
export function alertActions(alert: ProcessAlert): AlertAction[] {
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
}

export function actionLabel(action: AlertAction): string {
    return i18next.t(`processes:action.${action}`);
}

export function groupTitle(group: ProcessGroup, titles: ReadonlyMap<string, string>): { title: string; known: boolean } {
    // A session no node stands for, such as a launch, is named by the daemon.
    if (group.label !== undefined) {
        return { title: group.label, known: true };
    }
    const title = group.nodeId === null ? undefined : titles.get(group.nodeId);
    return title === undefined ? { title: i18next.t(`processes:group.${group.kind}`), known: group.nodeId === null } : { title, known: true };
}

/* Where a warning is drawn: under the row of its node, under the row that holds its process, or above the list. */
export function alertPlacement(alert: ProcessAlert, groups: readonly ProcessGroup[]): string | null {
    const byNode = alert.nodeId === null ? undefined : groups.find((group) => group.nodeId === alert.nodeId);
    if (byNode !== undefined) {
        return byNode.id;
    }
    const byProcess =
        alert.pid === null ? undefined : groups.find((group) => group.processes.some((row) => row.pid === alert.pid && row.startTime === alert.startTime));
    return byProcess?.id ?? null;
}
