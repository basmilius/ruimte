import { useMemo, useSyncExternalStore } from 'react';
import type { EditorLanguage } from './editor-language';
import type { ProblemCounts } from './diagnostics';

const NONE: ProblemCounts = { error: 0, warning: 0, info: 0 };

function countsStore(language: EditorLanguage | null): { get(): ProblemCounts; subscribe(listener: () => void): () => void } {
    let current = language?.diagnostics.counts() ?? NONE;
    return {
        get: () => {
            const next = language?.diagnostics.counts() ?? NONE;
            if (next.error !== current.error || next.warning !== current.warning || next.info !== current.info) {
                current = next;
            }
            return current;
        },
        subscribe: (listener) => language?.diagnostics.onChange(listener) ?? (() => undefined)
    };
}

/* How many errors, warnings and infos the file has, said again when the servers report. */
export function useProblemCounts(language: EditorLanguage | null): ProblemCounts {
    const store = useMemo(() => countsStore(language), [language]);
    return useSyncExternalStore(store.subscribe, store.get);
}
