import { PROTOCOL_VERSION, type DatabaseError } from '@adecore/database/protocol';
import type { HelperProcess } from '@adecore/database/host';

interface Written {
    id: string;
    method: string;
    params: Record<string, unknown>;
}

/* What a scripted helper answers a request with; undefined leaves it to the defaults below. */
export type FakeAnswer = { result: unknown } | { error: DatabaseError } | undefined;

const RESULTS: Record<string, unknown> = {
    open: { session: 's1', server: { flavor: 'sqlite', version: '3' } },
    test: { server: { flavor: 'mariadb', version: '11' } },
    export: { rows: 0, bytes: 0, elapsedMs: 0 },
    sample: { columns: [], rows: [] },
    discover: { containers: [] },
    close: null
};

/* A helper that says it is ready as soon as the host listens and answers every request at once. */
export class FakeHelper implements HelperProcess {
    readonly written: Written[] = [];
    private readonly lines: ((line: string) => void)[] = [];
    private readonly answer: (method: string, params: Record<string, unknown>) => FakeAnswer;

    constructor(answer: (method: string, params: Record<string, unknown>) => FakeAnswer = () => undefined) {
        this.answer = answer;
    }

    write(line: string): void {
        const message = JSON.parse(line) as Written;
        this.written.push(message);
        const scripted = this.answer(message.method, message.params);
        const response =
            scripted !== undefined && 'error' in scripted
                ? { id: message.id, ok: false, error: scripted.error }
                : { id: message.id, ok: true, result: scripted === undefined ? (RESULTS[message.method] ?? null) : scripted.result };
        queueMicrotask(() => this.emit(JSON.stringify(response)));
    }

    onLine(listener: (line: string) => void): void {
        this.lines.push(listener);
        queueMicrotask(() => listener(JSON.stringify({ event: 'ready', protocol: PROTOCOL_VERSION, version: 'test' })));
    }

    onExit(): void {}

    kill(): void {}

    private emit(line: string): void {
        for (const listener of this.lines) {
            listener(line);
        }
    }
}
