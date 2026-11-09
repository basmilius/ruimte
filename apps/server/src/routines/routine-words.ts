import type { RoutineEntry, RoutineRun, RoutineSchedule } from '@ruimte/contracts';

export const DAY_NAMES = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

export const DAY_SETS: Record<string, readonly number[]> = {
    daily: [1, 2, 3, 4, 5, 6, 7],
    weekdays: [1, 2, 3, 4, 5],
    weekends: [6, 7]
};

function everyText(minutes: number): string {
    return minutes % 60 === 0 ? `${minutes / 60}h` : `${minutes}m`;
}

/* A schedule in the words `at` takes, so a list reads back as what an edit would give. */
export function scheduleText(schedule: RoutineSchedule): string {
    if (schedule.kind === 'once') {
        return `once ${schedule.date} ${schedule.time}`;
    }
    if (schedule.kind === 'cron') {
        return `cron ${schedule.expression}`;
    }
    const days = [...schedule.days].sort((a, b) => a - b).join(',');
    const named = Object.entries(DAY_SETS).find(([, set]) => set.join(',') === days)?.[0] ?? schedule.days.map((day) => DAY_NAMES[day - 1]).join(',');
    if (schedule.kind === 'interval') {
        return `${named} every ${everyText(schedule.every)} ${schedule.from}-${schedule.to}`;
    }
    return `${named} ${schedule.time}`;
}

export function approvalOf(entry: RoutineEntry): string {
    if (entry.approved) {
        return 'yes';
    }
    return entry.held === undefined ? 'declined' : 'held';
}

export function runStateOf(run: RoutineRun): string {
    return run.skipped === undefined ? run.state : `${run.state}:${run.skipped}`;
}
