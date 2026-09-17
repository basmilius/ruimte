import { useEffect, useRef, useState, type ReactNode } from 'react';
import { chatClient } from '@/chat';
import { emptyPromptDraft, nextPrompt, type PendingPrompt, type PromptDraft } from '@/chat/logic/prompts';
import { PendingDock, type PromptAction } from '@/chat/ui/PendingDock';

export function PromptComposer({
    chatId,
    pending,
    focused,
    disabled,
    hasDraft,
    denyReason,
    children
}: {
    chatId: string;
    pending: PendingPrompt[];
    focused: boolean;
    disabled: boolean;
    hasDraft: boolean;
    denyReason: boolean;
    children: ReactNode;
}) {
    const [activeId, setActiveId] = useState<string | null>(null);
    const [completed, setCompleted] = useState<string[]>([]);
    const [drafts, setDrafts] = useState<Record<string, PromptDraft>>({});
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<{ id: string; message: string } | null>(null);
    const ref = useRef<HTMLDivElement>(null);
    const busy = useRef(false);
    const pressedRequest = useRef<string | null>(null);
    const stillCompleted = completed.filter((id) => pending.some((item) => item.requestId === id));
    if (stillCompleted.length !== completed.length) {
        setCompleted(stillCompleted);
    }
    const waiting = pending.filter((item) => !completed.includes(item.requestId));
    const active = nextPrompt(waiting, activeId);
    const activeKey = active?.requestId ?? null;
    const expanded = !!active;

    if (activeKey !== activeId) {
        setActiveId(activeKey);
        setError(null);
    }

    useEffect(() => {
        if (focused && expanded && !ref.current?.querySelector('.prompt-card')?.contains(document.activeElement)) {
            ref.current?.querySelector<HTMLElement>('.prompt-heading')?.focus({ preventScroll: true });
        }
    }, [activeKey, expanded, focused]);

    const finish = (id: string) => {
        setCompleted((current) => [...current, id]);
        setDrafts((current) => {
            const next = { ...current };
            delete next[id];
            return next;
        });
    };
    const act = async (item: PendingPrompt, action: PromptAction) => {
        if (busy.current || disabled) {
            return;
        }
        busy.current = true;
        setSending(true);
        setError(null);
        try {
            if (action.kind === 'approve') {
                await chatClient.approve(chatId, item.requestId, action.decision, action.message);
            } else if (action.kind === 'answer') {
                await chatClient.answer(chatId, item.requestId, action.answers);
            } else {
                await chatClient.dismiss(chatId, item.id);
            }
            finish(item.requestId);
        } catch (cause) {
            setError({ id: item.requestId, message: cause instanceof Error ? cause.message : String(cause) });
        } finally {
            busy.current = false;
            setSending(false);
        }
    };
    return (
        <div
            ref={ref}
            onPointerDownCapture={() => {
                pressedRequest.current = expanded ? activeKey : null;
            }}
            onClickCapture={(event) => {
                // A press that began on Send cannot become Allow when a request arrives underneath it.
                if (event.detail > 0 && (event.target as HTMLElement).closest('.prompt-card') && pressedRequest.current !== activeKey) {
                    event.preventDefault();
                    event.stopPropagation();
                }
            }}
        >
            {active && (
                <div hidden={!expanded}>
                    <PendingDock
                        key={activeKey}
                        item={active}
                        draft={drafts[active.requestId] ?? emptyPromptDraft()}
                        onDraft={(draft) => setDrafts((current) => ({ ...current, [active.requestId]: draft }))}
                        onAction={(action) => void act(active, action)}
                        more={waiting.length - 1}
                        hasDraft={hasDraft}
                        denyReason={denyReason}
                        disabled={disabled}
                        sending={sending}
                        error={error?.id === active.requestId ? error.message : null}
                    />
                </div>
            )}
            <div hidden={expanded}>{children}</div>
        </div>
    );
}
