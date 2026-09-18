import { useEffect, useRef } from 'react';
import clsx from 'clsx';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { StatusDot } from '@/canvas/NodeFrame';
import { isTypingTarget } from '@/canvas/canvas-shortcuts';
import { leavePromptStack, PROMPT_STACK_ATTRIBUTE, usePromptFront } from '@/canvas/prompt-stack';
import { stackFront, type CanvasPrompt } from '@/canvas/prompts';
import { useCanvasPrompts } from '@/canvas/use-canvas-prompts';
import { chatClientFor, sessionClientFor } from '@/transport/connections';
import { agentName } from '@/processes/format';
import { isApplePlatform } from '@/desktop/bridge';
import { pageKey } from '@/prompts/logic/keys';
import { answerPrompt, promptCreatedAt } from '@/prompts/logic/subjects';
import { useFocusAfterAnswer } from '@/prompts/logic/useFocusAfterAnswer';
import { usePromptSession } from '@/prompts/logic/usePromptSession';
import { PROMPT_SURFACE } from '@/prompts/ui/PromptCard';
import { PromptView } from '@/prompts/ui/PromptView';
import { formatClock } from '@/shell/usage/format';
import { useCanvas, useCanvasStore } from '@/state/canvas';
import { useNodeStatus } from '@/state/chats';
import { useEndpointId } from '@/state/keys';
import { useProviders } from '@/state/providers';
import { useTransportStatus } from '@/transport/status';
import { BTN_GROUP } from '@/ui/classes';
import { ErrorBoundary } from '@/ui/ErrorBoundary';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';

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
    const node = useCanvas((s) => s.nodes[prompt.subject.nodeId]);
    const status = useNodeStatus(node ?? { id: prompt.subject.nodeId, kind: prompt.surface });
    return (
        <div className="flex min-w-0 items-center gap-2 border-b border-dashed border-border px-3 py-1.5 text-xs text-text-muted">
            {status && <StatusDot status={status} />}
            <Tooltip label="Go to node">
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
                    <Tooltip label="Previous prompt" name>
                        <button type="button" className="icon-btn h-6 w-6" disabled={index === 0} onClick={() => onStep(-1)}>
                            <Icon icon={ChevronLeft} size={14} />
                        </button>
                    </Tooltip>
                    <span className="px-1 tabular-nums">
                        {index + 1} of {count}
                    </span>
                    <Tooltip label="Next prompt" name>
                        <button type="button" className="icon-btn h-6 w-6" disabled={index === count - 1} onClick={() => onStep(1)}>
                            <Icon icon={ChevronRight} size={14} />
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
    const prompts = useCanvasPrompts();
    const canvasStore = useCanvasStore();
    const endpointId = useEndpointId();
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
        canvasStore.getState().goToNode(nodeId);
    };
    const reveal = (): void => {
        canvasStore.getState().goToNode(nodeId);
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
                <div className={`${PROMPT_SURFACE} relative focus-within:border-accent`}>
                    <ErrorBoundary label="This prompt failed to render" resetKeys={[active.id]} className="relative p-3">
                        <PromptView
                            key={active.id}
                            subject={active.subject}
                            draft={session.draftOf(active.id)}
                            onDraft={(draft) => session.setDraft(active.id, draft)}
                            onAction={(action) => {
                                refocus.hold();
                                void session
                                    .act(active, () =>
                                        answerPrompt(active.subject, action, { chat: chatClientFor(endpointId), sessions: sessionClientFor(endpointId) })
                                    )
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
