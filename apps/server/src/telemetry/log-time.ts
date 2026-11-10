type LogMethod = (...data: unknown[]) => void;

const METHODS = ['log', 'info', 'warn', 'error', 'debug'] as const;

/* `2026-10-16T08:35:12.000Z message`: the first argument carries the time, so a format string keeps working. */
export function stamped(at: Date, data: readonly unknown[]): unknown[] {
    const time = at.toISOString();
    const [first, ...rest] = data;
    if (typeof first === 'string') {
        return [`${time} ${first}`, ...rest];
    }
    return [time, ...data];
}

export function stampConsole(target: Pick<Console, (typeof METHODS)[number]> = console, now: () => Date = () => new Date()): void {
    for (const method of METHODS) {
        const original: LogMethod = target[method].bind(target);
        target[method] = (...data: unknown[]) => original(...stamped(now(), data));
    }
}
