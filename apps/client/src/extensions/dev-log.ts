import { extensionRequest } from '@/extensions/machine-request';
import { transport } from '@/transport';
import { fireAndForget } from '@/transport-api/transport';

function textOf(value: unknown): string {
    if (typeof value === 'string') {
        return value;
    }

    if (value instanceof Error) {
        return value.stack ?? value.message;
    }

    try {
        return JSON.stringify(value) ?? String(value);
    } catch {
        return String(value);
    }
}

/* To the terminal that runs `ruimte extension dev`. Losing a line is fine: this is for reading along. */
export function sendDevLog(id: string, level: string, args: readonly unknown[]): void {
    const text = `[client] ${level === 'log' ? '' : `${level}: `}${args.map(textOf).join(' ')}`;

    void fireAndForget('extensionRequest', extensionRequest(transport, 'extension.log', { id, text: text.slice(0, 16_000) }));
}

const LEVELS = ['log', 'info', 'warn', 'error', 'debug'] as const;

/* The `console` an extension's bundle reads. An extension in development also says it in that terminal. */
export function consoleFor(id: string, dev: boolean): Console {
    if (!dev) {
        return console;
    }

    const copy = Object.create(console) as Console;

    for (const level of LEVELS) {
        copy[level] = (...args: unknown[]) => {
            console[level](...args);
            sendDevLog(id, level, args);
        };
    }

    return copy;
}
