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

/*
 * What extensions find for this query, each source's rows as soon as it answers, in the order of the sources. One that
 * fails or is slow costs only its own rows.
 */
export function usePaletteHits(query: string, enabled: boolean): readonly PaletteHit[] {
    const sources = useContributions((state) => state.paletteSources);
    const [found, setFound] = useState<{ query: string; bySource: Readonly<Record<string, readonly PaletteHit[]>> }>({ query: '', bySource: {} });
    const searching = enabled && sources.length > 0 && query.trim() !== '';

    useEffect(() => {
        if (!searching) {
            return undefined;
        }

        let current = true;
        const search = async (source: (typeof sources)[number]): Promise<void> => {
            const hits = (await source.search(query)).map((hit) => ({ ...hit, id: `${source.id}/${hit.id}`, source: source.title }));

            if (current) {
                setFound((before) => ({ query, bySource: { ...(before.query === query ? before.bySource : {}), [source.id]: hits } }));
            }
        };
        const timer = setTimeout(() => {
            for (const source of sources) {
                void search(source).catch(() => undefined);
            }
        }, SEARCH_WAIT_MS);

        return () => {
            current = false;
            clearTimeout(timer);
        };
    }, [sources, query, searching]);

    if (!searching || found.query !== query) {
        return NO_HITS;
    }

    const hits = sources.flatMap((source) => found.bySource[source.id] ?? []);

    return hits.length === 0 ? NO_HITS : hits;
}
