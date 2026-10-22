import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import type { Compiled } from './react-compiler-babel.ts';

/*
 * The React Compiler on a few worker threads (`react-compiler-worker.ts`), started at the first module.
 * A caller compiles on its own thread once a worker cannot start or fails. Babel also leaves its own
 * stack trace rewriter on the thread it runs on, which Vite's module set-up cannot live with under Bun.
 */
export class CompilerPool {
    private workers: Worker[] | null = null;
    private broken = false;
    private next = 0;
    private jobs = 0;
    private readonly waiting = new Map<number, { resolve(value: Compiled | null): void; reject(error: Error): void }>();

    /* Null when the pool is out of use, so the caller compiles on its own thread. */
    async compile(code: string, id: string): Promise<Compiled | null> {
        const workers = this.started();
        if (workers === null) {
            return null;
        }
        const job = ++this.jobs;
        return new Promise((resolve, reject) => {
            this.waiting.set(job, { resolve, reject });
            workers[this.next++ % workers.length]!.postMessage({ job, code, id });
        });
    }

    close(): void {
        this.broken = true;
        this.drop();
    }

    private started(): Worker[] | null {
        if (this.broken) {
            return null;
        }
        if (this.workers === null) {
            try {
                // The rest of the computer stays usable while the first start compiles; more threads gained nothing measured.
                const count = Math.max(1, Math.min(6, availableParallelism() - 2));
                this.workers = Array.from({ length: count }, () => this.spawn());
            } catch {
                this.broken = true;
                this.drop();
                return null;
            }
        }
        return this.workers;
    }

    private spawn(): Worker {
        const worker = new Worker(new URL('./react-compiler-worker.ts', import.meta.url));
        // The pool never keeps a server that is stopping alive.
        worker.unref();
        worker.on('message', (message: { job: number; code?: string | null; map?: object | null; error?: string }) => {
            const waiting = this.waiting.get(message.job);
            this.waiting.delete(message.job);
            if (message.error !== undefined) {
                waiting?.reject(new Error(message.error));
            } else {
                waiting?.resolve({ code: message.code ?? null, map: message.map ?? null });
            }
        });
        worker.on('error', () => {
            this.broken = true;
            this.drop();
        });
        return worker;
    }

    // What still waited goes back to Vite's own thread.
    private drop(): void {
        for (const waiting of this.waiting.values()) {
            waiting.resolve(null);
        }
        this.waiting.clear();
        for (const worker of this.workers ?? []) {
            void worker.terminate();
        }
        this.workers = null;
    }
}
