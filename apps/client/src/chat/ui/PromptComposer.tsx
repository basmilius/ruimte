import { useEffect, useRef, type ReactNode } from 'react';
import { ArrowDown, Hand, MessageCircleQuestionMark } from 'lucide-react';
import { bringPromptToFront } from '@/canvas/prompt-stack';
import { chatClient } from '@/chat';
import { nextPrompt, type PendingPrompt } from '@/prompts/logic/prompts';
import { answerPrompt, type PromptSubject } from '@/prompts/logic/subjects';
import { usePromptSession } from '@/prompts/logic/usePromptSession';
import { PromptView } from '@/prompts/ui/PromptView';
import { Icon } from '@/ui/Icon';

const requestIdOf = (item: PendingPrompt): string => item.requestId;

export function PromptComposer({
    chatId,
    pending,
    focused,
    elsewhere,
    disabled,
    hasDraft,
    denyReason,
    children
}: {
    chatId: string;
    pending: PendingPrompt[];
    focused: boolean;
    /* The canvas's prompt stack answers the prompt; the composer only says where it went. */
    elsewhere: boolean;
    disabled: boolean;
    hasDraft: boolean;
    denyReason: boolean;
    children: ReactNode;
}) {
    const session = usePromptSession({ prompts: pending, idOf: requestIdOf, pick: nextPrompt, disabled });
    const ref = useRef<HTMLDivElement>(null);
    const { active, activeId: activeKey } = session;
    const expanded = !!active;
    const subject: PromptSubject | null = active && { kind: 'chat', nodeId: chatId, item: active };

    useEffect(() => {
        if (focused && expanded && !elsewhere && !ref.current?.querySelector('.prompt-card')?.contains(document.activeElement)) {
            ref.current?.querySelector<HTMLElement>('.prompt-heading')?.focus({ preventScroll: true });
        }
    }, [activeKey, expanded, focused, elsewhere]);

    return (
        <div ref={ref} onPointerDownCapture={session.onPointerDownCapture} onClickCapture={session.onClickCapture}>
            {active && subject && elsewhere && (
                <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3.5 py-3 text-left text-sm text-text-muted hover:text-text"
                    onClick={() => bringPromptToFront(chatId)}
                >
                    <Icon icon={active.kind === 'approval' ? Hand : MessageCircleQuestionMark} size={16} className="shrink-0 text-status-needs-you" />
                    <span className="grow">Waiting for your answer below</span>
                    <Icon icon={ArrowDown} size={16} className="shrink-0" />
                </button>
            )}
            {active && subject && !elsewhere && (
                <div hidden={!expanded}>
                    <PromptView
                        key={activeKey}
                        subject={subject}
                        draft={session.draftOf(active.requestId)}
                        onDraft={(draft) => session.setDraft(active.requestId, draft)}
                        onAction={(action) => void session.act(active, () => answerPrompt(subject, action, { chat: chatClient, sessions: null }))}
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
