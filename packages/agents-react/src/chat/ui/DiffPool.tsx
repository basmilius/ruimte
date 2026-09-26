import { useEffect, type ReactNode } from 'react';
import { useWorkerPool, WorkerPoolContextProvider } from '@pierre/diffs/react';
import { useDiffTheme } from './diff-theme';

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

/*
 * Shares one highlighter pool between every diff under it; the provider keeps a singleton behind the
 * scenes. How a worker of `@pierre/diffs/worker` is made is the bundler's business, so the app says.
 */
export default function DiffPool({ workerFactory, children }: { workerFactory: () => Worker; children: ReactNode }) {
    const theme = useDiffTheme();
    return (
        <WorkerPoolContextProvider
            poolOptions={{
                poolSize: POOL_SIZE,
                workerFactory
            }}
            highlighterOptions={{ theme }}
        >
            <ThemeSync />
            {children}
        </WorkerPoolContextProvider>
    );
}
