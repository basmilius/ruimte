import { useEffect, useRef, type ReactNode } from 'react';
import { chatClient } from '@/chat';
import { nextPrompt, type PendingPrompt, type PromptAction } from '@/prompts/logic/prompts';
import { usePromptSession } from '@/prompts/logic/usePromptSession';
import { PromptView } from '@/prompts/ui/PromptView';

const requestIdOf = (item: PendingPrompt): string => item.requestId;

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
    const session = usePromptSession({ prompts: pending, idOf: requestIdOf, pick: nextPrompt, disabled });
    const ref = useRef<HTMLDivElement>(null);
    const { active, activeId: activeKey } = session;
    const expanded = !!active;

    useEffect(() => {
        if (focused && expanded && !ref.current?.querySelector('.prompt-card')?.contains(document.activeElement)) {
            ref.current?.querySelector<HTMLElement>('.prompt-heading')?.focus({ preventScroll: true });
        }
    }, [activeKey, expanded, focused]);

    const send = (item: PendingPrompt, action: PromptAction): Promise<void> => {
        if (action.kind === 'approve') {
            return chatClient.approve(chatId, item.requestId, action.decision, action.message);
        }
        if (action.kind === 'answer') {
            return chatClient.answer(chatId, item.requestId, action.answers);
        }
        return chatClient.dismiss(chatId, item.id);
    };
    return (
        <div ref={ref} onPointerDownCapture={session.onPointerDownCapture} onClickCapture={session.onClickCapture}>
            {active && (
                <div hidden={!expanded}>
                    <PromptView
                        key={activeKey}
                        item={active}
                        draft={session.draftOf(active.requestId)}
                        onDraft={(draft) => session.setDraft(active.requestId, draft)}
                        onAction={(action) => void session.act(active, () => send(active, action))}
                        more={session.waiting.length - 1}
                        hasDraft={hasDraft}
                        denyReason={denyReason}
                        disabled={disabled}
                        sending={session.sending}
                        error={session.errorOf(active.requestId)}
                    />
                </div>
            )}
            <div hidden={expanded}>{children}</div>
        </div>
    );
}
