import type { LanguageLogLine } from '@ruimte/contracts';

const MAX_LINES = 500;
const MAX_LINE_LENGTH = 2000;

/* The last lines a kind wrote, for the status UI to show when something went wrong. Bounded, so a chatty server costs memory only up to a cap. */
export class LanguageLog {
    private readonly lines: LanguageLogLine[] = [];
    private readonly now: () => number;

    constructor(now: () => number = Date.now) {
        this.now = now;
    }

    push(stream: LanguageLogLine['stream'], text: string): void {
        const at = this.now();
        for (const raw of text.split(/\r?\n/)) {
            const line = raw.trimEnd();
            if (line === '') {
                continue;
            }
            this.lines.push({ at, stream, text: line.length > MAX_LINE_LENGTH ? `${line.slice(0, MAX_LINE_LENGTH)}...` : line });
        }
        if (this.lines.length > MAX_LINES) {
            this.lines.splice(0, this.lines.length - MAX_LINES);
        }
    }

    tail(count = MAX_LINES): LanguageLogLine[] {
        return this.lines.slice(-count);
    }

    /* The last line of a stream, which is where a process says why it ended. */
    last(stream: LanguageLogLine['stream']): string | null {
        return this.lines.findLast((line) => line.stream === stream)?.text ?? null;
    }
}
