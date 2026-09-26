import type { ReactNode } from 'react';
import DiffPool from '@ruimte/agents-react/chat/ui/DiffPool';
// Vite's `?worker`, not a bare import in a worker entry. The package marks itself side-effect free, so a bare import there gets tree-shaken to nothing.
import DiffWorker from '@pierre/diffs/worker/worker.js?worker';

const makeWorker = (): Worker => new DiffWorker();

/* The chat's highlighter pool, with its workers made the way Vite bundles them. */
export default function ChatDiffPool({ children }: { children: ReactNode }) {
    return <DiffPool workerFactory={makeWorker}>{children}</DiffPool>;
}
