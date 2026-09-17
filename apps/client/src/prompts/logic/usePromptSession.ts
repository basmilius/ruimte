import { useRef, useState, type MouseEvent } from 'react';
import { emptyPromptDraft, type PromptDraft } from '@/prompts/logic/prompts';

interface PromptSessionOptions<T> {
    prompts: readonly T[];
    idOf(prompt: T): string;
    /* Which waiting prompt is in front, given the one that was and where it stood; a new prompt never takes the place of the one being read. */
    pick(waiting: readonly T[], activeId: string | null, activeIndex: number): T | null;
    disabled: boolean;
}

export interface PromptSession<T> {
    active: T | null;
    activeId: string | null;
    /* Where the active prompt stands among the waiting ones. */
    index: number;
    /* The prompts not answered yet from this card, in the order they came in. */
    waiting: readonly T[];
    setActive(id: string): void;
    draftOf(id: string): PromptDraft;
    setDraft(id: string, draft: PromptDraft): void;
    sending: boolean;
    errorOf(id: string): string | null;
    /* `busy` when another answer is still on its way, so this one was never sent. */
    act(prompt: T, send: () => Promise<void>): Promise<'sent' | 'failed' | 'busy'>;
    onPointerDownCapture(): void;
    onClickCapture(event: MouseEvent): void;
}

/*
 * What answering a row of prompts needs besides the prompts: a draft per request that survives
 * paging, one send at a time, the error of the request that failed, and the requests answered here
 * that the machine has not taken off yet.
 */
export function usePromptSession<T>({ prompts, idOf, pick, disabled }: PromptSessionOptions<T>): PromptSession<T> {
    const [activeId, setActiveId] = useState<string | null>(null);
    const [activeIndex, setActiveIndex] = useState(0);
    const [completed, setCompleted] = useState<string[]>([]);
    const [drafts, setDrafts] = useState<Record<string, PromptDraft>>({});
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<{ id: string; message: string } | null>(null);
    const busy = useRef(false);
    const pressedRequest = useRef<string | null>(null);
    const stillCompleted = completed.filter((id) => prompts.some((prompt) => idOf(prompt) === id));
    if (stillCompleted.length !== completed.length) {
        setCompleted(stillCompleted);
    }
    const waiting = prompts.filter((prompt) => !completed.includes(idOf(prompt)));
    const active = pick(waiting, activeId, activeIndex);
    const activeKey = active === null ? null : idOf(active);
    const index = active === null ? 0 : waiting.indexOf(active);
    if (index !== activeIndex) {
        setActiveIndex(index);
    }

    if (activeKey !== activeId) {
        setActiveId(activeKey);
        setError(null);
    }

    const finish = (id: string) => {
        setCompleted((current) => [...current, id]);
        setDrafts((current) => {
            const next = { ...current };
            delete next[id];
            return next;
        });
    };
    const act = async (prompt: T, send: () => Promise<void>): Promise<'sent' | 'failed' | 'busy'> => {
        if (busy.current || disabled) {
            return 'busy';
        }
        const id = idOf(prompt);
        busy.current = true;
        setSending(true);
        setError(null);
        try {
            await send();
            finish(id);
            return 'sent';
        } catch (cause) {
            setError({ id, message: cause instanceof Error ? cause.message : String(cause) });
            return 'failed';
        } finally {
            busy.current = false;
            setSending(false);
        }
    };
    return {
        active,
        activeId: activeKey,
        index,
        waiting,
        setActive: (id) => {
            setActiveId(id);
            setError(null);
        },
        draftOf: (id) => drafts[id] ?? emptyPromptDraft(),
        setDraft: (id, draft) => setDrafts((current) => ({ ...current, [id]: draft })),
        sending,
        errorOf: (id) => (error?.id === id ? error.message : null),
        act,
        onPointerDownCapture: () => {
            pressedRequest.current = activeKey;
        },
        onClickCapture: (event) => {
            // A press that began on Send cannot become Allow when a request arrives underneath it.
            if (event.detail > 0 && (event.target as HTMLElement).closest('.prompt-card') && pressedRequest.current !== activeKey) {
                event.preventDefault();
                event.stopPropagation();
            }
        }
    };
}
