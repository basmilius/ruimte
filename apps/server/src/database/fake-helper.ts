import { PROTOCOL_VERSION } from '@adecore/database/protocol';
import type { HelperProcess } from '@adecore/database/host';

interface Written {
    id: string;
    method: string;
    params: Record<string, unknown>;
}

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

    write(line: string): void {
        const message = JSON.parse(line) as Written;
        this.written.push(message);
        queueMicrotask(() => this.emit(JSON.stringify({ id: message.id, ok: true, result: RESULTS[message.method] ?? null })));
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
