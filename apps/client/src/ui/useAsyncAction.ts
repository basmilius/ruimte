import { useState } from 'react';
import { messageOf } from '@/pulsar/account';

interface AsyncAction {
    busy: boolean;
    failure: string | null;
    /* Says whether the work went through, so a caller closes or steps on only on the way out. */
    run(work: () => Promise<unknown>): Promise<boolean>;
    /* A refusal a surface can see for itself, which reads in the same line as one that came back. */
    fail(message: string): void;
    clear(): void;
}

/* One step a surface waits on: the button goes quiet while it runs and the reason stays on screen when it does not. */
export function useAsyncAction(fallback?: string): AsyncAction {
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState<string | null>(null);
    const run = async (work: () => Promise<unknown>): Promise<boolean> => {
        setBusy(true);
        setFailure(null);
        try {
            await work();
            return true;
        } catch (e) {
            setFailure(messageOf(e, fallback));
            return false;
        } finally {
            setBusy(false);
        }
    };
    return { busy, failure, run, fail: setFailure, clear: () => setFailure(null) };
}
