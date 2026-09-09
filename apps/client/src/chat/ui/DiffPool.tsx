import type { ReactNode } from 'react';
import { WorkerPoolContextProvider } from '@pierre/diffs/react';
import DiffWorker from '@pierre/diffs/worker/worker.js?worker';
import { DIFF_THEME } from '@/chat/ui/diff-theme';

// Two workers keep highlighting off the main thread without holding a shiki instance per chat node.
const POOL_SIZE = 2;

/* Shares one highlighter pool between every diff on the canvas; the provider keeps a singleton behind the scenes. */
export default function DiffPool({ children }: { children: ReactNode }) {
    return (
        <WorkerPoolContextProvider
            poolOptions={{
                poolSize: POOL_SIZE,
                workerFactory: () => new DiffWorker()
            }}
            highlighterOptions={{ theme: DIFF_THEME }}
        >
            {children}
        </WorkerPoolContextProvider>
    );
}
