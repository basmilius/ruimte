import { useEffect, useRef, useState } from 'react';
import i18next from 'i18next';
import type { FsGrepMatch } from '@ruimte/contracts';
import { performAsPerson } from '@/actions/client-actions';

// Long enough that a typed word is one search, short enough that the list feels like it follows.
const GREP_DEBOUNCE_MS = 140;
const GREP_LIMIT = 200;

export interface GrepOptions {
    caseSensitive: boolean;
    wholeWord: boolean;
    regex: boolean;
}

export const DEFAULT_GREP_OPTIONS: GrepOptions = { caseSensitive: false, wholeWord: false, regex: false };

export interface GrepState {
    matches: readonly FsGrepMatch[];
    /* How many files those matches come from, which the header says next to their count. */
    files: number;
    truncated: boolean;
    /* What the daemon refused the query for, a broken regex above all. */
    failure: string | null;
    busy: boolean;
}

/* What was searched for, kept with the answer: it is what says whether the answer is the one the
   person is waiting for, without a second state that has to be set in step with this one. */
interface Answer {
    query: string;
    matches: readonly FsGrepMatch[];
    files: number;
    truncated: boolean;
    failure: string | null;
}

const NOTHING: Answer = { query: '', matches: [], files: 0, truncated: false, failure: null };

/* One file's hits under the name they share, in the order the search walked them. */
export interface GrepGroup {
    path: string;
    /* Where this group's first hit sits in the flat list the arrow keys walk. */
    offset: number;
    matches: FsGrepMatch[];
}

export const groupByFile = (matches: readonly FsGrepMatch[]): GrepGroup[] => {
    const groups: GrepGroup[] = [];
    for (const [index, match] of matches.entries()) {
        const last = groups.at(-1);
        if (last && last.path === match.path) {
            last.matches.push(match);
        } else {
            groups.push({ path: match.path, offset: index, matches: [match] });
        }
    }
    return groups;
};

/* The line a hit's context opens on, so the block draws its own numbers without counting back. */
export const firstContextLine = (match: FsGrepMatch): number => match.line - match.before.length;

/*
 * What the daemon finds for the query the person is typing. Every keystroke asks again after the
 * debounce, and an answer that a later keystroke has already outrun is dropped rather than shown.
 */
export const useGrepSearch = (folder: string | null, query: string, options: GrepOptions): GrepState => {
    const [answer, setAnswer] = useState<Answer>(NOTHING);
    const generation = useRef(0);

    useEffect(() => {
        const trimmed = query.trim();
        const mine = ++generation.current;
        if (folder === null || trimmed === '') {
            return;
        }
        const timer = window.setTimeout(() => {
            performAsPerson('file.grep', {
                query: trimmed,
                limit: GREP_LIMIT,
                caseSensitive: options.caseSensitive,
                wholeWord: options.wholeWord,
                regex: options.regex
            })
                .then((result) => {
                    if (mine === generation.current) {
                        setAnswer({ ...result, query: trimmed, failure: null });
                    }
                })
                .catch((e: unknown) => {
                    if (mine === generation.current) {
                        setAnswer({ ...NOTHING, query: trimmed, failure: e instanceof Error ? e.message : i18next.t('shell:findInFiles.badSearch') });
                    }
                });
        }, GREP_DEBOUNCE_MS);
        return () => {
            window.clearTimeout(timer);
        };
    }, [folder, query, options.caseSensitive, options.wholeWord, options.regex]);

    const trimmed = query.trim();
    if (folder === null || trimmed === '') {
        return { ...NOTHING, busy: false };
    }
    /* The hits of the query before this one stay up while the next answer is on its way: a list
       that empties on every keystroke flickers, and what is shown is never presented as current. */
    return { ...answer, busy: answer.query !== trimmed };
};
