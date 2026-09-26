import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDown, Hand, MessageCircleQuestionMark } from 'lucide-react';
import { PERSON_PROMPT_CLIENTS } from '@/actions/client-actions';
import { bringPromptToFront } from '@/canvas/prompt-stack';
import { focusPromptStart } from '@/prompts/logic/focus';
import { orderPrompts, type PendingPrompt } from '@/prompts/logic/prompts';
import { answerPrompt, isBlockingSubject, promptCreatedAt, promptIdOf, type PromptSubject } from '@/prompts/logic/subjects';
import { useFocusAfterAnswer } from '@/prompts/logic/useFocusAfterAnswer';
import { usePromptSession } from '@/prompts/logic/usePromptSession';
import { PromptView } from '@/prompts/ui/PromptView';
import { useNodeComputerApprovals } from '@/state/computer';
import { useEndpointId } from '@/state/keys';
import { Icon } from '@ruimte/ui/Icon';

/* The one being read stays in front; otherwise blocking before optional, oldest first, as everywhere else. */
const pickSubject = (waiting: readonly PromptSubject[], activeId: string | null): PromptSubject | null =>
    waiting.find((subject) => promptIdOf(subject) === activeId) ?? orderPrompts(waiting, isBlockingSubject, promptCreatedAt)[0] ?? null;

export function PromptComposer({
    chatId,
    pending,
    focused,
    elsewhere,
    disabled,
    hasDraft,
    denyReason,
    onAllAnswered,
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
    /* Takes the keyboard back to the composer once the last prompt was answered from its card. */
    onAllAnswered?: () => void;
    children: ReactNode;
}) {
    const { t } = useTranslation('chat');
    const endpointId = useEndpointId();
    const computer = useNodeComputerApprovals(endpointId, chatId);
    // A card about operating an app waits in the chat beside the CLI's own requests.
    const subjects = useMemo(
        (): PromptSubject[] => [
            ...pending.map((item): PromptSubject => ({ kind: 'chat', nodeId: chatId, item })),
            ...computer.map((request): PromptSubject => ({ kind: 'computer-approval', nodeId: chatId, request }))
        ],
        [pending, computer, chatId]
    );
    const session = usePromptSession({ prompts: subjects, idOf: promptIdOf, pick: pickSubject, disabled });
    const ref = useRef<HTMLDivElement>(null);
    const { active, activeId: activeKey } = session;
    const expanded = !!active;
    const refocus = useFocusAfterAnswer(activeKey, ref, () => onAllAnswered?.());

    useEffect(() => {
        if (focused && expanded && !elsewhere && !ref.current?.querySelector('.prompt-card')?.contains(document.activeElement)) {
            focusPromptStart(ref.current);
        }
    }, [activeKey, expanded, focused, elsewhere]);

    return (
        <div ref={ref} onPointerDownCapture={session.onPointerDownCapture} onClickCapture={session.onClickCapture}>
            {active && elsewhere && (
                <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3.5 py-3 text-left text-sm text-text-muted hover:text-text"
                    onClick={() => bringPromptToFront(chatId)}
                >
                    <Icon
                        icon={active.kind !== 'chat' || active.item.kind === 'approval' ? Hand : MessageCircleQuestionMark}
                        size={16}
                        className="shrink-0 text-status-needs-you"
                    />
                    <span className="grow">{t('composer.waitingBelow')}</span>
                    <Icon icon={ArrowDown} size={16} className="shrink-0" />
                </button>
            )}
            {active && !elsewhere && (
                <div hidden={!expanded}>
                    <PromptView
                        key={activeKey}
                        subject={active}
                        draft={session.draftOf(promptIdOf(active))}
                        onDraft={(draft) => session.setDraft(promptIdOf(active), draft)}
                        onAction={(action) => {
                            refocus.hold();
                            void session
                                .act(active, () => answerPrompt(active, action, PERSON_PROMPT_CLIENTS))
                                .then((result) => {
                                    if (result === 'failed') {
                                        refocus.release();
                                    }
                                });
                        }}
                        more={session.waiting.length - 1}
                        hasDraft={hasDraft}
                        denyReason={denyReason}
                        disabled={disabled}
                        sending={session.sending}
                        error={session.errorOf(promptIdOf(active))}
                    />
                </div>
            )}
            <div hidden={expanded}>{children}</div>
        </div>
    );
}
