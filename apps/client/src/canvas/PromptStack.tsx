import { useEffect, useRef } from 'react';
import clsx from 'clsx';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { focusNodeAction, PERSON_PROMPT_CLIENTS } from '@/actions/client-actions';
import { StatusDot } from '@/canvas/NodeFrame';
import { isTypingTarget } from '@/canvas/canvas-shortcuts';
import { leavePromptStack, PROMPT_STACK_ATTRIBUTE, usePromptFront } from '@/canvas/prompt-stack';
import { stackFront, type CanvasPrompt } from '@/canvas/prompts';
import { useCanvasPrompts } from '@/canvas/use-canvas-prompts';
import { agentName } from '@/processes/format';
import { isApplePlatform } from '@/desktop/bridge';
import { pageKey } from '@ruimte/agents-react/prompts/logic/keys';
import { answerPrompt, promptCreatedAt } from '@ruimte/agents-react/prompts/logic/subjects';
import { useFocusAfterAnswer } from '@ruimte/agents-react/prompts/logic/useFocusAfterAnswer';
import { usePromptSession } from '@ruimte/agents-react/prompts/logic/usePromptSession';
import { PROMPT_SURFACE } from '@ruimte/agents-react/prompts/ui/PromptCard';
import { PromptView } from '@ruimte/agents-react/prompts/ui/PromptView';
import { formatClock } from '@ruimte/agents-react/usage/format';
import { useCanvas, useCanvasStore } from '@/state/canvas';
import { useNodeStatus } from '@/state/chats';
import { useProviders } from '@ruimte/agents-react/state/providers';
import { useTransportStatus } from '@/transport/status';
import { BTN_GROUP } from '@ruimte/ui/classes';
import { ErrorBoundary } from '@ruimte/ui/ErrorBoundary';
import { Icon } from '@ruimte/ui/Icon';
import { Tooltip } from '@ruimte/ui/Tooltip';

const idOf = (prompt: CanvasPrompt): string => prompt.id;

/* Which node is asking, and the way through the stack. Drawn only in the stack, never in a chat. */
function SourceRow({
    prompt,
    index,
    count,
    onStep,
    onGoTo
}: {
    prompt: CanvasPrompt;
    index: number;
    count: number;
    onStep(delta: number): void;
    onGoTo(): void;
}) {
    const { t } = useTranslation('canvas');
    const node = useCanvas((s) => s.nodes[prompt.subject.nodeId]);
    const status = useNodeStatus(node ?? { id: prompt.subject.nodeId, kind: prompt.surface });
    return (
        <div className="flex min-w-0 items-center gap-2 border-b border-dashed border-border px-3 py-1.5 text-xs text-text-muted">
            {status && <StatusDot status={status} />}
            <Tooltip label={t('promptStack.goToNode')}>
                <button type="button" className="min-w-0 truncate font-medium text-text hover:underline" onClick={onGoTo}>
                    {prompt.title}
                </button>
            </Tooltip>
            <span className="min-w-0 shrink-0 truncate">
                {[prompt.provider === null ? null : agentName(prompt.provider), prompt.surface, formatClock(promptCreatedAt(prompt.subject))]
                    .filter((part) => part !== null)
                    .join(' · ')}
            </span>
            <span className="grow" />
            {count > 1 && (
                <span className={`${BTN_GROUP} shrink-0`}>
                    <Tooltip label={t('promptStack.previous')} name>
                        <button type="button" className="icon-btn icon-btn-xs" disabled={index === 0} onClick={() => onStep(-1)}>
                            <Icon icon={ChevronLeft} size={12} />
                        </button>
                    </Tooltip>
                    <span className="px-1 tabular-nums">{t('promptStack.position', { index: index + 1, count })}</span>
                    <Tooltip label={t('promptStack.next')} name>
                        <button type="button" className="icon-btn icon-btn-xs" disabled={index === count - 1} onClick={() => onStep(1)}>
                            <Icon icon={ChevronRight} size={12} />
                        </button>
                    </Tooltip>
                </span>
            )}
        </div>
    );
}

/*
 * What the chats and terminals on this canvas are asking, as a stack of cards above the dock. The
 * front card is the whole prompt; at most two edges behind it say more are waiting. It never takes
 * the keyboard by itself, so typing in a terminal goes on while a card arrives.
 */
export function PromptStack({ viewId, dockShown }: { viewId: string; dockShown: boolean }) {
    const { t } = useTranslation('canvas');
    const prompts = useCanvasPrompts();
    const canvasStore = useCanvasStore();
    const disabled = useTransportStatus() !== 'open';
    const providers = useProviders((row) => row.providers);
    const session = usePromptSession({
        prompts,
        idOf,
        pick: (waiting, activeId, activeIndex) => {
            const id = stackFront(waiting.map(idOf), activeId, activeIndex);
            return waiting.find((prompt) => prompt.id === id) ?? null;
        },
        disabled
    });
    const { active, waiting, index } = session;
    const container = useRef<HTMLDivElement>(null);
    // With no card left the keyboard goes back to where Mod+Shift+P took it from, or to the canvas.
    const refocus = useFocusAfterAnswer(active?.id ?? null, container, leavePromptStack);

    const front = usePromptFront((s) => s.request);
    const { setActive } = session;
    useEffect(() => {
        if (front === null) {
            return;
        }
        const target = waiting.find((prompt) => prompt.subject.nodeId === front.nodeId);
        if (target) {
            setActive(target.id);
            usePromptFront.getState().consume(front.seq);
        }
    }, [front, waiting, setActive]);

    if (active === null) {
        return null;
    }

    const nodeId = active.subject.nodeId;
    const goTo = (): void => {
        focusNodeAction(viewId, nodeId);
    };
    const reveal = (): void => {
        focusNodeAction(viewId, nodeId);
        canvasStore.getState().activateNode(nodeId);
    };
    const denyReason = active.subject.kind === 'chat' && providers.find((provider) => provider.kind === active.provider)?.capabilities.denyReason === true;
    const edges = Math.min(waiting.length - 1, 2);
    const step = (delta: number): void => {
        const next = waiting[index + delta];
        if (next) {
            refocus.hold();
            setActive(next.id);
        }
    };

    return (
        <div
            {...{ [PROMPT_STACK_ATTRIBUTE]: viewId }}
            className={clsx(
                'pointer-events-none absolute inset-x-0 flex justify-center px-4 transition-[bottom] duration-200',
                dockShown ? 'bottom-16' : 'bottom-4'
            )}
        >
            <div
                ref={container}
                data-holds-dock
                className="pointer-events-auto relative w-full max-w-xl"
                onPointerDownCapture={session.onPointerDownCapture}
                onClickCapture={session.onClickCapture}
                onKeyDown={(event) => {
                    const delta = pageKey(event.nativeEvent, isApplePlatform(), isTypingTarget(event.target));
                    if (delta !== null) {
                        event.preventDefault();
                        event.stopPropagation();
                        step(delta);
                    }
                }}
            >
                {edges >= 2 && <div aria-hidden className={`${PROMPT_SURFACE} absolute inset-x-6 -top-3 h-4`} />}
                {edges >= 1 && <div aria-hidden className={`${PROMPT_SURFACE} absolute inset-x-3 -top-1.5 h-4`} />}
                <div className={`${PROMPT_SURFACE} focus-ring-within relative`}>
                    <ErrorBoundary label={t('promptStack.failed')} resetKeys={[active.id]} className="relative p-3">
                        <PromptView
                            key={active.id}
                            subject={active.subject}
                            draft={session.draftOf(active.id)}
                            onDraft={(draft) => session.setDraft(active.id, draft)}
                            onAction={(action) => {
                                refocus.hold();
                                void session
                                    .act(active, () => answerPrompt(active.subject, action, PERSON_PROMPT_CLIENTS))
                                    .then((result) => {
                                        if (result === 'failed') {
                                            refocus.release();
                                        }
                                    });
                            }}
                            onReveal={reveal}
                            more={0}
                            hasDraft={false}
                            denyReason={denyReason}
                            disabled={disabled}
                            sending={session.sending}
                            error={session.errorOf(active.id)}
                            top={<SourceRow prompt={active} index={index} count={waiting.length} onStep={step} onGoTo={goTo} />}
                        />
                    </ErrorBoundary>
                </div>
            </div>
        </div>
    );
}
