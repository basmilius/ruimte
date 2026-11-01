import { useEffect, useState } from 'react';
import { useContributions } from '@/extensions/registry';

const SEARCH_WAIT_MS = 150;
const NO_HITS: readonly PaletteHit[] = [];

export interface PaletteHit {
    id: string;
    title: string;
    detail?: string;
    source: string;
    run: () => void;
}

/* What extensions find for this query. One that fails or is slow costs only its own rows. */
export function usePaletteHits(query: string, enabled: boolean): readonly PaletteHit[] {
    const sources = useContributions((state) => state.paletteSources);
    const [found, setFound] = useState<{ query: string; hits: readonly PaletteHit[] }>({ query: '', hits: NO_HITS });
    const searching = enabled && sources.length > 0 && query.trim() !== '';

    useEffect(() => {
        if (!searching) {
            return undefined;
        }

        let current = true;
        const timer = setTimeout(() => {
            void Promise.allSettled(
                sources.map(async (source) => (await source.search(query)).map((hit) => ({ ...hit, id: `${source.id}/${hit.id}`, source: source.title })))
            ).then((answers) => {
                if (current) {
                    setFound({ query, hits: answers.flatMap((answer) => (answer.status === 'fulfilled' ? answer.value : [])) });
                }
            });
        }, SEARCH_WAIT_MS);

        return () => {
            current = false;
            clearTimeout(timer);
        };
    }, [sources, query, searching]);

    return searching && found.query === query ? found.hits : NO_HITS;
}
