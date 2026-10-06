/*
 * What a page wrote to its console during a preview, as lines an agent reads: the console API, an
 * uncaught exception with its stack, and the browser's own errors and warnings, such as a script
 * that did not load. A page that logs in a loop would fill an agent's window, so it is capped.
 */

export type ConsoleLevel = 'log' | 'info' | 'warning' | 'error' | 'exception';

export interface ConsoleEntry {
    level: ConsoleLevel;
    text: string;
}

export const CONSOLE_LIMITS = { messages: 20, characters: 500 } as const;

const LEVELS: Readonly<Record<string, ConsoleLevel>> = {
    log: 'log',
    debug: 'log',
    dir: 'log',
    dirxml: 'log',
    table: 'log',
    trace: 'log',
    count: 'log',
    timeEnd: 'log',
    startGroup: 'log',
    startGroupCollapsed: 'log',
    info: 'info',
    warning: 'warning',
    warn: 'warning',
    error: 'error',
    assert: 'error'
};

/* The level of a console call by the name the browser gives it; null for one that writes nothing, such as `clear`. */
export function consoleLevel(type: string): ConsoleLevel | null {
    return LEVELS[type] ?? null;
}

interface PreviewProperty {
    name?: string;
    type?: string;
    value?: string;
    valuePreview?: ObjectPreview;
}

interface ObjectPreview {
    type?: string;
    subtype?: string;
    description?: string;
    overflow?: boolean;
    properties?: PreviewProperty[];
}

/* How the browser hands over an object, a function or an error the page logged. */
interface RemoteValue {
    type?: string;
    subtype?: string;
    className?: string;
    description?: string;
    value?: unknown;
    unserializableValue?: string;
    preview?: ObjectPreview;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function previewText(preview: ObjectPreview): string {
    const properties = preview.properties ?? [];
    const more = preview.overflow ? ', ...' : '';
    const valueOf = (property: PreviewProperty): string => {
        if (property.valuePreview) {
            return previewText(property.valuePreview);
        }
        return property.type === 'string' ? JSON.stringify(property.value ?? '') : String(property.value ?? property.type ?? '');
    };
    if (preview.subtype === 'array') {
        return `[${properties.map(valueOf).join(', ')}${more}]`;
    }
    const body = `{${properties.map((property) => `${property.name ?? ''}: ${valueOf(property)}`).join(', ')}${more}}`;
    return preview.description && preview.description !== 'Object' ? `${preview.description} ${body}` : body;
}

/* One argument of a console call: a primitive arrives as itself, anything else as the browser describes it. */
export function argumentText(argument: unknown): string {
    if (typeof argument === 'string') {
        return argument;
    }
    if (!isRecord(argument)) {
        return String(argument);
    }
    const remote = argument as RemoteValue;
    if (remote.subtype === 'error' && remote.description) {
        return remote.description;
    }
    if (remote.preview) {
        return previewText(remote.preview);
    }
    if (remote.unserializableValue !== undefined) {
        return remote.unserializableValue;
    }
    if ('value' in remote) {
        return typeof remote.value === 'string' ? remote.value : (JSON.stringify(remote.value) ?? String(remote.value));
    }
    return remote.description ?? remote.className ?? remote.type ?? '';
}

/* The arguments of a console call as the console shows them, with its `%s`-style placeholders filled in and `%c` styles dropped. */
export function consoleText(argumentsOf: readonly unknown[]): string {
    const [first, ...rest] = argumentsOf;
    if (typeof first !== 'string' || !/%[sdifoOc]/.test(first)) {
        return argumentsOf.map(argumentText).join(' ');
    }
    let next = 0;
    const filled = first.replace(/%([sdifoOc%])/g, (whole, kind: string) => {
        if (kind === '%') {
            return '%';
        }
        if (next >= rest.length) {
            return whole;
        }
        const value = rest[next++];
        if (kind === 'c') {
            return '';
        }
        const text = argumentText(value);
        if (kind === 'd' || kind === 'i') {
            return String(Math.trunc(Number(text)));
        }
        return kind === 'f' ? String(Number(text)) : text;
    });
    return [filled, ...rest.slice(next).map(argumentText)].join(' ');
}

interface ExceptionDetails {
    text?: string;
    url?: string;
    lineNumber?: number;
    columnNumber?: number;
    exception?: RemoteValue;
}

/* An uncaught exception with its stack, or with the place it was thrown when the thrown value carries none. */
export function exceptionText(details: ExceptionDetails): string {
    const thrown = details.exception;
    const described = thrown?.subtype === 'error' && thrown.description ? thrown.description : thrown === undefined ? null : argumentText(thrown);
    const text = described === null ? (details.text ?? 'Uncaught exception') : `Uncaught ${described}`;
    if (/\n\s+at /.test(text) || details.url === undefined || details.url === '' || details.lineNumber === undefined) {
        return text;
    }
    return `${text} (${details.url}:${details.lineNumber + 1}:${(details.columnNumber ?? 0) + 1})`;
}

interface LogEntry {
    level?: string;
    text?: string;
    url?: string;
}

/* A message of the browser itself, a failed load for one; only errors and warnings, since the rest is about the browser and not the page. */
export function browserEntry(entry: LogEntry): ConsoleEntry | null {
    if ((entry.level !== 'error' && entry.level !== 'warning') || !entry.text) {
        return null;
    }
    const text = entry.url && !entry.text.includes(entry.url) ? `${entry.text} (${entry.url})` : entry.text;
    return { level: entry.level, text };
}

/* A stack on one line, so a row stays a row. */
function oneLine(text: string): string {
    return text
        .replace(/\s*[\r\n]+\s*/g, ' ')
        .replace(/\t/g, ' ')
        .trim();
}

/* The first messages of a page, each cut to a size an agent's window takes, and how many more there were. */
export class ConsoleLog {
    readonly entries: ConsoleEntry[] = [];
    omitted = 0;

    add(level: ConsoleLevel, text: string): void {
        if (this.entries.length >= CONSOLE_LIMITS.messages) {
            this.omitted++;
            return;
        }
        const line = oneLine(text);
        const cut = line.length > CONSOLE_LIMITS.characters ? `${line.slice(0, CONSOLE_LIMITS.characters - 3)}...` : line;
        this.entries.push({ level, text: cut });
    }
}
