import { jumpToTimelineItem } from '@adecore/agents-react/chat';
import { messageOf } from '@adecore/ui';
import type { ChatExternalResult, ChatExternalSession, ChatSearchHit, ChatSearchResult } from '@ruimte/contracts';
import i18next from 'i18next';
import { useEffect, useRef, useState } from 'react';
import { perform } from '@/action-port/perform';
import { focusChat } from '@/plan/plan-actions';
import { matches } from '@/shell/palette-entries';
import { currentEndpointId } from '@/state/current-endpoint';
import { endpointKey } from '@/state/keys';
import { useToasts } from '@/state/toasts';
import { machineFor } from '@/transport/connections';

// The same pause the search in files takes: a typed word is one search.
const CHAT_SEARCH_DEBOUNCE_MS = 140;

interface ChatSearchState {
    hits: readonly ChatSearchHit[];
    /* The title of every chat with a hit, in the order the hits come. */
    chats: ChatSearchResult['chats'];
    searched: number;
    failed: ChatSearchResult['failed'];
    truncated: boolean;
    cancelled: boolean;
    /* What the machine refused the search for. */
    failure: string | null;
    busy: boolean;
}

/* What was asked and for which project, kept with the answer: it is what says whether the answer is the one being waited for. */
export interface ChatSearchAnswer extends ChatSearchResult {
    projectId: string;
    query: string;
    failure: string | null;
}

const NOTHING: ChatSearchAnswer = {
    projectId: '',
    query: '',
    hits: [],
    chats: [],
    searched: 0,
    failed: [],
    truncated: false,
    cancelled: false,
    failure: null
};

const IDLE: ChatSearchState = { hits: [], chats: [], searched: 0, failed: [], truncated: false, cancelled: false, failure: null, busy: false };

/* The answer as the list shows it. Hits of the search before this one stay up while the next is on its way, never presented as current. */
export function chatSearchState(answer: ChatSearchAnswer, projectId: string | null, query: string): ChatSearchState {
    const trimmed = query.trim();
    if (projectId === null || trimmed === '') {
        return IDLE;
    }
    const { hits, chats, searched, failed, truncated, cancelled, failure } = answer;
    return { hits, chats, searched, failed, truncated, cancelled, failure, busy: answer.projectId !== projectId || answer.query !== trimmed };
}

/* One chat's hits under its title, in the order the search found them. */
interface ChatHitGroup {
    chatId: string;
    title: string;
    hits: ChatSearchHit[];
}

export function groupByChat(hits: readonly ChatSearchHit[], chats: ChatSearchResult['chats']): ChatHitGroup[] {
    const groups: ChatHitGroup[] = [];
    for (const hit of hits) {
        const last = groups.at(-1);
        if (last?.chatId === hit.chatId) {
            last.hits.push(hit);
        } else {
            groups.push({ chatId: hit.chatId, title: chats.find((chat) => chat.chatId === hit.chatId)?.title ?? '', hits: [hit] });
        }
    }
    return groups;
}

let searches = 0;

/*
 * What the machine finds in the chats of the project for the query being typed. A new query, or the
 * palette closing, asks the machine to stop the search before it, and an answer that was outrun is dropped.
 */
export function useChatSearch(projectId: string | null, query: string): ChatSearchState {
    const [answer, setAnswer] = useState<ChatSearchAnswer>(NOTHING);
    const generation = useRef(0);

    useEffect(() => {
        const trimmed = query.trim();
        const mine = ++generation.current;
        if (projectId === null || trimmed === '') {
            return;
        }
        const searchId = `palette-${(searches += 1)}`;
        const endpointId = currentEndpointId();
        let started = false;
        const timer = window.setTimeout(() => {
            started = true;
            perform('chat.search', { query: trimmed, searchId })
                .then((result) => {
                    if (mine === generation.current) {
                        setAnswer({ ...result, projectId, query: trimmed, failure: null });
                    }
                })
                .catch((e: unknown) => {
                    if (mine === generation.current) {
                        setAnswer({ ...NOTHING, projectId, query: trimmed, failure: messageOf(e, i18next.t('shell:palette.noChatMatch')) });
                    }
                });
        }, CHAT_SEARCH_DEBOUNCE_MS);
        return () => {
            window.clearTimeout(timer);
            if (started) {
                void machineFor(endpointId)
                    ?.transport.request('chat.searchCancel', { searchId })
                    .catch(() => undefined);
            }
        };
    }, [projectId, query]);

    return chatSearchState(answer, projectId, query);
}

/* Shows the chat and lights up the message; a message the thread no longer holds says so. */
export function openChatHit(endpointId: string, hit: ChatSearchHit): void {
    focusChat(hit.chatId);
    jumpToTimelineItem(endpointKey(endpointId, hit.chatId), hit.itemId, {
        flash: true,
        onMissing: () => useToasts.getState().show({ kind: 'error', title: i18next.t('shell:palette.messageGone') })
    });
}

interface ExternalSessionsState {
    sessions: readonly ChatExternalSession[];
    failed: ChatExternalResult['failed'];
    failure: string | null;
}

const NO_EXTERNAL: ExternalSessionsState = { sessions: [], failed: [], failure: null };

/* The CLI sessions of this project that were started outside the app, asked for once each time the palette opens in chat mode. */
export function useExternalSessions(projectId: string | null): ExternalSessionsState {
    const [state, setState] = useState<{ projectId: string; value: ExternalSessionsState } | null>(null);

    useEffect(() => {
        if (projectId === null) {
            return;
        }
        let current = true;
        perform('chat.external', {})
            .then((result) => current && setState({ projectId, value: { sessions: result.sessions, failed: result.failed, failure: null } }))
            .catch((e: unknown) => current && setState({ projectId, value: { ...NO_EXTERNAL, failure: messageOf(e, '') } }));
        return () => {
            current = false;
        };
    }, [projectId]);

    return state !== null && state.projectId === projectId ? state.value : NO_EXTERNAL;
}

/* Sessions whose title mentions every word typed; nothing typed lists them all, newest first as the machine sent them. */
export function externalMatching(sessions: readonly ChatExternalSession[], query: string): ChatExternalSession[] {
    return sessions.filter((session) => matches(query, `${session.title} ${session.provider}`));
}

/* A chat view that goes on with the session, in the account whose folder holds it. */
export function resumeExternal(session: ChatExternalSession): Promise<unknown> {
    return perform('view.create', {
        kind: 'chat',
        name: session.title === '' ? null : session.title,
        url: null,
        command: null,
        path: null,
        provider: session.provider,
        ...(session.account === undefined ? {} : { account: session.account }),
        resume: session.sessionId,
        cwd: session.cwd
    });
}
