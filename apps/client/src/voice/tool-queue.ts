export class VoiceToolQueue {
    private tail: Promise<unknown> = Promise.resolve();
    private cancelled = false;

    private readonly revision: () => number;

    constructor(revision: () => number) {
        this.revision = revision;
    }

    run<T>(execute: () => Promise<T>): Promise<T> {
        const revision = this.revision();
        const run = this.tail.then(() => {
            if (this.cancelled || revision !== this.revision()) {
                throw new Error('The voice session or project changed. Inspect the current workspace before retrying.');
            }
            return execute();
        });
        this.tail = run.catch(() => undefined);
        return run;
    }

    cancel(): void {
        this.cancelled = true;
    }
}
