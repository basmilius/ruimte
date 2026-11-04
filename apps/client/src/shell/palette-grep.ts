import { messageOf } from '@adecore/ui';
import type { FsGrepMatch } from '@ruimte/contracts';
import i18next from 'i18next';
import { useEffect, useRef, useState } from 'react';
import { perform } from '@/actions/client-actions';

// Long enough that a typed word is one search, short enough that the list feels like it follows.
const GREP_DEBOUNCE_MS = 140;
const GREP_LIMIT = 200;

export interface GrepOptions {
    caseSensitive: boolean;
    wholeWord: boolean;
    regex: boolean;
}

export const DEFAULT_GREP_OPTIONS: GrepOptions = { caseSensitive: false, wholeWord: false, regex: false };

interface GrepState {
    matches: readonly FsGrepMatch[];
    /* How many files those matches come from, which the header says next to their count. */
    files: number;
    truncated: boolean;
    /* What the daemon refused the query for, a broken regex above all. */
    failure: string | null;
    busy: boolean;
}

/* What was searched for, where and how, kept with the answer: it is what says whether the answer is
   the one the person is waiting for, without a second state that has to be set in step with this one. */
export interface GrepAnswer {
    folder: string;
    query: string;
    options: GrepOptions;
    matches: readonly FsGrepMatch[];
    files: number;
    truncated: boolean;
    failure: string | null;
}

const NOTHING: GrepAnswer = { folder: '', query: '', options: DEFAULT_GREP_OPTIONS, matches: [], files: 0, truncated: false, failure: null };

/* The answer as the list shows it. The hits of the search before this one stay up while the next
   answer is on its way: a list that empties on every keystroke flickers, and what is shown is never
   presented as current. */
export function grepState(answer: GrepAnswer, folder: string | null, query: string, options: GrepOptions): GrepState {
    const trimmed = query.trim();
    if (folder === null || trimmed === '') {
        return { matches: [], files: 0, truncated: false, failure: null, busy: false };
    }
    const current =
        answer.folder === folder &&
        answer.query === trimmed &&
        answer.options.caseSensitive === options.caseSensitive &&
        answer.options.wholeWord === options.wholeWord &&
        answer.options.regex === options.regex;
    return { matches: answer.matches, files: answer.files, truncated: answer.truncated, failure: answer.failure, busy: !current };
}

/* One file's hits under the name they share, in the order the search walked them. */
interface GrepGroup {
    path: string;
    matches: FsGrepMatch[];
}

export function groupByFile(matches: readonly FsGrepMatch[]): GrepGroup[] {
    const groups: GrepGroup[] = [];
    for (const match of matches) {
        const last = groups.at(-1);
        if (last?.path === match.path) {
            last.matches.push(match);
        } else {
            groups.push({ path: match.path, matches: [match] });
        }
    }
    return groups;
}

/* The line a hit's context opens on, so the block draws its own numbers without counting back. */
export function firstContextLine(match: FsGrepMatch): number {
    return match.line - match.before.length;
}

/*
 * What the daemon finds for the query the person is typing. Every keystroke asks again after the
 * debounce, and an answer that a later keystroke has already outrun is dropped rather than shown.
 */
export function useGrepSearch(folder: string | null, query: string, options: GrepOptions): GrepState {
    const [answer, setAnswer] = useState<GrepAnswer>(NOTHING);
    const generation = useRef(0);
    const { caseSensitive, wholeWord, regex } = options;

    useEffect(() => {
        const trimmed = query.trim();
        const mine = ++generation.current;
        if (folder === null || trimmed === '') {
            return;
        }
        const asked = { folder, query: trimmed, options: { caseSensitive, wholeWord, regex } };
        const timer = window.setTimeout(() => {
            perform('file.grep', { query: trimmed, limit: GREP_LIMIT, caseSensitive, wholeWord, regex })
                .then((result) => {
                    if (mine === generation.current) {
                        setAnswer({ ...result, ...asked, failure: null });
                    }
                })
                .catch((e: unknown) => {
                    if (mine === generation.current) {
                        setAnswer({ ...NOTHING, ...asked, failure: messageOf(e, i18next.t('shell:findInFiles.badSearch')) });
                    }
                });
        }, GREP_DEBOUNCE_MS);
        return () => {
            window.clearTimeout(timer);
        };
    }, [folder, query, caseSensitive, wholeWord, regex]);

    return grepState(answer, folder, query, options);
}
