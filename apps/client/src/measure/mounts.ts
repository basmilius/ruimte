import { useEffect } from 'react';

type MountedKind = 'terminal' | 'terminal-plate' | 'chat' | 'file';

interface MountCount {
    mounted: number;
    /* Every mount since the page loaded, so a body that keeps remounting shows as a climbing number. */
    mounts: number;
}

const counts = new Map<MountedKind, MountCount>();

function countOf(kind: MountedKind): MountCount {
    let count = counts.get(kind);
    if (count === undefined) {
        count = { mounted: 0, mounts: 0 };
        counts.set(kind, count);
    }
    return count;
}

function useCountedMount(kind: MountedKind): void {
    useEffect(() => {
        const count = countOf(kind);
        count.mounted += 1;
        count.mounts += 1;
        return () => {
            count.mounted -= 1;
        };
    }, [kind]);
}

function useNothing(): void {}

/* Counts the bodies on screen for the dev-only measurements (`measure/recorder.ts`); a production build counts nothing. */
export const useMountCount: (kind: MountedKind) => void = import.meta.env.DEV ? useCountedMount : useNothing;

export function mountCounts(): Record<string, MountCount> {
    return Object.fromEntries([...counts].map(([kind, count]) => [kind, { ...count }]));
}
