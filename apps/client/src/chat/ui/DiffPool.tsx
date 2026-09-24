import { useEffect, type ReactNode } from 'react';
import { useWorkerPool, WorkerPoolContextProvider } from '@pierre/diffs/react';
// Vite's `?worker`, not a bare import in a worker entry. The package marks itself side-effect free, so a bare import there gets tree-shaken to nothing.
import DiffWorker from '@pierre/diffs/worker/worker.js?worker';
import { useDiffTheme } from '@/chat/ui/diff-theme';

// Two workers keep highlighting off the main thread without holding a shiki instance per chat node.
const POOL_SIZE = 2;

/* The pool reads its highlighter options once, when the singleton is made, and its theme wins over a diff's own. */
function ThemeSync() {
    const pool = useWorkerPool();
    const theme = useDiffTheme();
    useEffect(() => {
        void pool?.setRenderOptions({ theme });
    }, [pool, theme]);
    return null;
}

/* Shares one highlighter pool between every diff on the canvas; the provider keeps a singleton behind the scenes. */
export default function DiffPool({ children }: { children: ReactNode }) {
    const theme = useDiffTheme();
    return (
        <WorkerPoolContextProvider
            poolOptions={{
                poolSize: POOL_SIZE,
                workerFactory: () => new DiffWorker()
            }}
            highlighterOptions={{ theme }}
        >
            <ThemeSync />
            {children}
        </WorkerPoolContextProvider>
    );
}
