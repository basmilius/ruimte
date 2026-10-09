import { SESSION_PORT_VERIFY_MAX_AGE_MS, type SessionPort, type SessionPortsResult, type SessionPortVerification } from '@ruimte/contracts';
import { TransportError, type Transport } from '@/transport/transport';

export interface PortWatchOptions {
    transport: Pick<Transport, 'request' | 'on'>;
    sessionId: string;
    live(): boolean;
    changed(result: SessionPortsResult): void;
    schedule?: (callback: () => void) => () => void;
    now?: () => number;
    deadline?: (callback: () => void, ms: number) => () => void;
}

export class SessionPortWatch {
    private readonly options: PortWatchOptions;
    private active = true;
    private polling = false;
    private opening = false;
    private cancelTimer: (() => void) | null = null;
    private readonly offExit: () => void;
    private cancelVerification: (() => void) | null = null;

    constructor(options: PortWatchOptions) {
        this.options = options;
        this.offExit = options.transport.on('session.exit', ({ sessionId }) => {
            if (sessionId === options.sessionId) {
                this.stop();
            }
        });
    }

    async poll(): Promise<void> {
        if (!this.live() || this.polling) {
            return;
        }
        this.polling = true;
        let result: SessionPortsResult;
        try {
            result = await this.options.transport.request('session.ports', { sessionId: this.options.sessionId });
        } catch (error) {
            result = { status: error instanceof TransportError && error.code === 'unknown-request' ? 'unavailable' : 'unknown' };
        } finally {
            this.polling = false;
        }
        if (!this.live()) {
            return;
        }
        this.options.changed(result);
        if (result.status === 'closed' || result.status === 'unavailable') {
            this.stop();
            return;
        }
        this.cancelTimer = (this.options.schedule ?? schedulePoll)(() => {
            this.cancelTimer = null;
            void this.poll();
        });
    }

    async open(listener: SessionPort, open: (url: string, machineId: string) => Promise<void>): Promise<void> {
        if (!this.live() || this.opening) {
            return;
        }
        this.opening = true;
        const now = this.options.now ?? (() => performance.now());
        const started = now();
        let expire!: () => void;
        const expired = new Promise<null>((resolve) => {
            expire = () => resolve(null);
        });
        const cancelDeadline = (this.options.deadline ?? scheduleTimeout)(expire, SESSION_PORT_VERIFY_MAX_AGE_MS);
        this.cancelVerification = expire;
        try {
            const result: SessionPortVerification | null = await Promise.race([
                this.options.transport.request('session.verifyPort', { sessionId: this.options.sessionId, listener }),
                expired
            ]);
            if (!this.live()) {
                return;
            }
            const elapsed = now() - started;
            if (result === null) {
                this.options.changed({ status: 'unknown' });
                return;
            }
            if (!result.machineId || !result.validForMs) {
                this.options.changed({ status: 'unavailable' });
                this.stop();
                return;
            }
            if (elapsed < 0 || elapsed >= Math.min(result.validForMs, SESSION_PORT_VERIFY_MAX_AGE_MS)) {
                this.options.changed({ status: 'unknown' });
                return;
            }
            await open(result.url, result.machineId);
        } catch (error) {
            if (this.live()) {
                if (error instanceof TransportError && error.code === 'unknown-request') {
                    this.options.changed({ status: 'unavailable' });
                    this.stop();
                    return;
                }
                this.options.changed({ status: 'unknown' });
                throw error;
            }
        } finally {
            cancelDeadline();
            this.cancelVerification = null;
            this.opening = false;
        }
    }

    stop(): void {
        this.active = false;
        this.cancelTimer?.();
        this.cancelTimer = null;
        this.cancelVerification?.();
        this.offExit();
    }

    private live(): boolean {
        return this.active && this.options.live();
    }
}

function schedulePoll(callback: () => void): () => void {
    return scheduleTimeout(callback, 5000);
}

function scheduleTimeout(callback: () => void, ms: number): () => void {
    const timer = setTimeout(callback, ms);
    return () => clearTimeout(timer);
}
