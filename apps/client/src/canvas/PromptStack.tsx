import { useEffect, useRef, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import clsx from 'clsx';
import { AlarmClock, AlarmClockOff, ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { focusNodeAction, PERSON_PROMPT_CLIENTS } from '@/actions/client-actions';
import { StatusDot } from '@/canvas/NodeFrame';
import { isTypingTarget } from '@/canvas/canvas-shortcuts';
import { bringPromptToFront, leavePromptStack, PROMPT_STACK_ATTRIBUTE, usePromptFold, usePromptFront, useSnoozedList } from '@/canvas/prompt-stack';
import { stackFront, type CanvasPrompt } from '@/canvas/prompts';
import { useCanvasPrompts } from '@/canvas/use-canvas-prompts';
import { agentName } from '@/processes/format';
import { promptHeadline } from '@/prompts/prompt-headline';
import { designChatInFront } from '@/project/views';
import { isApplePlatform } from '@/desktop/bridge';
import { pageKey, answerPrompt, promptCreatedAt, useFocusAfterAnswer, usePromptSession, PROMPT_SURFACE, PromptView } from '@adecore/agents-react/prompts';
import { useChatHost } from '@adecore/agents-react';
import { formatClock } from '@adecore/agents-react/usage';
import { useCanvas, useCanvasStore } from '@/state/canvas';
import { useNodeStatus } from '@/state/chats';
import { endpointOfNode, useEndpointId } from '@/state/keys';
import { snoozeOf, useSnoozes } from '@/state/snooze';
import { SnoozeButton } from '@/shell/Snooze';
import { formatMoment } from '@adecore/ui/format';
import { useProviders } from '@adecore/agents-react/state';
import { useTransportStatus } from '@/transport/status';
import { ButtonGroup, ErrorBoundary, Icon, IconButton, Menu, Pill, Tooltip } from '@adecore/ui';

/* Marks the chevron that folds or opens the stack, which keeps the keyboard across the change. */
const FOLD_ATTRIBUTE = 'data-prompt-fold';

/* Names the node of a row in the snoozed list, so a request for that node can put the keyboard on it. */
const SNOOZED_OWNER_ATTRIBUTE = 'data-snoozed-owner';

function idOf(prompt: CanvasPrompt): string {
    return prompt.id;
}

/* Whether a prompt is the one a request to bring `nodeId` to the front means. */
function asks(prompt: CanvasPrompt, nodeId: string): boolean {
    return (prompt.sourceNodeId ?? prompt.subject.nodeId) === nodeId || prompt.ownerId === nodeId;
}

/* The machine a prompt's owner runs on, which is where its snooze is kept. */
function useOwnerMachine(ownerId: string): string {
    const endpointId = useEndpointId();
    const node = useCanvas((s) => s.nodes[ownerId]);
    return node ? endpointOfNode(node, endpointId) : endpointId;
}

/* Where the stack stands on its canvas: bottom center, above the dock while it shows. */
function StackPlace({ viewId, dockShown, children }: { viewId: string; dockShown: boolean; children: ReactNode }) {
    return (
        <div
            {...{ [PROMPT_STACK_ATTRIBUTE]: viewId }}
            className={clsx(
                'pointer-events-none absolute inset-x-0 flex justify-center px-4 transition-[bottom] duration-200',
                dockShown ? 'bottom-16' : 'bottom-4'
            )}
        >
            {children}
        </div>
    );
}

/* One row per snoozed node, each ending its snooze early. The snooze clock takes a row out by itself once its time runs out. */
function SnoozedMenu({
    snoozed,
    open,
    focusOwner,
    onOpenChange
}: {
    snoozed: readonly CanvasPrompt[];
    open: boolean;
    focusOwner: string | null;
    onOpenChange(open: boolean): void;
}) {
    const { t } = useTranslation(['canvas', 'shell']);
    const endpointId = useEndpointId();
    const nodes = useCanvas((s) => s.nodes);
    const snoozes = useSnoozes((s) => s.byKey);
    const owners = [...new Set(snoozed.map((prompt) => prompt.ownerId))];
    // After the menu put the keyboard on its list, so the row asked for is the one that is highlighted.
    useEffect(() => {
        if (!open || focusOwner === null) {
            return;
        }
        const frame = requestAnimationFrame(() => {
            document.querySelector<HTMLElement>(`[${SNOOZED_OWNER_ATTRIBUTE}="${CSS.escape(focusOwner)}"]`)?.focus({ preventScroll: true });
        });
        return () => cancelAnimationFrame(frame);
    }, [open, focusOwner]);
    const unsnooze = (ownerId: string, machine: string): void => {
        useSnoozes.getState().unsnooze(machine, ownerId);
        bringPromptToFront(ownerId);
    };
    return (
        <Menu.Root open={open} onOpenChange={onOpenChange}>
            <Menu.Trigger className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-raised px-2.5 py-0.5 text-xs text-text-muted shadow-float hover:text-text">
                <Icon icon={AlarmClock} size={12} />
                {t('promptStack.snoozed', { count: owners.length })}
            </Menu.Trigger>
            <Menu.Popup align="end" className="min-w-56">
                <Menu.Group>
                    <Menu.GroupLabel>{t('promptStack.snoozedList')}</Menu.GroupLabel>
                    {owners.map((ownerId) => {
                        const node = nodes[ownerId];
                        const machine = node ? endpointOfNode(node, endpointId) : endpointId;
                        const until = snoozeOf(snoozes, machine, ownerId);
                        const title = node?.title ?? snoozed.find((prompt) => prompt.ownerId === ownerId)!.title;
                        return (
                            <Menu.Item key={ownerId} {...{ [SNOOZED_OWNER_ATTRIBUTE]: ownerId }} onClick={() => unsnooze(ownerId, machine)}>
                                <Icon icon={AlarmClockOff} size={14} />
                                {/* Read as part of the row, so its name says what a press does and the count and time stay in it. */}
                                <span className="sr-only">{`${t('shell:snooze.unsnooze')} `}</span>
                                <span className="truncate">{title}</span>
                                <span className="shrink-0 text-text-muted tabular-nums">
                                    {t('promptStack.prompts', { count: snoozed.filter((prompt) => prompt.ownerId === ownerId).length })}
                                </span>
                                {until !== null && <Menu.Hint>{formatMoment(until)}</Menu.Hint>}
                            </Menu.Item>
                        );
                    })}
                </Menu.Group>
            </Menu.Popup>
        </Menu.Root>
    );
}

/* The status of the node that asks, for the dot beside its title. */
function useAskingStatus(prompt: CanvasPrompt) {
    const node = useCanvas((s) => s.nodes[prompt.sourceNodeId ?? prompt.subject.nodeId]);
    return useNodeStatus(node ?? { id: prompt.sourceNodeId ?? prompt.subject.nodeId, kind: prompt.surface });
}

/* Which node is asking, and the way through the stack. Drawn only in the stack, never in a chat. */
function SourceRow({
    prompt,
    index,
    count,
    onStep,
    onGoTo,
    onFold
}: {
    prompt: CanvasPrompt;
    index: number;
    count: number;
    onStep(delta: number): void;
    onGoTo(): void;
    onFold(): void;
}) {
    const { t } = useTranslation('canvas');
    const status = useAskingStatus(prompt);
    const machine = useOwnerMachine(prompt.ownerId);
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
                <ButtonGroup render={<span />} className="shrink-0">
                    <IconButton icon={ChevronLeft} size="xs" label={t('promptStack.previous')} disabled={index === 0} onClick={() => onStep(-1)} />
                    <span className="px-1 tabular-nums">{t('promptStack.position', { index: index + 1, count })}</span>
                    <IconButton icon={ChevronRight} size="xs" label={t('promptStack.next')} disabled={index === count - 1} onClick={() => onStep(1)} />
                </ButtonGroup>
            )}
            <SnoozeButton endpointId={machine} nodeId={prompt.ownerId} />
            <IconButton {...{ [FOLD_ATTRIBUTE]: '' }} icon={ChevronDown} size="xs" label={t('promptStack.fold')} aria-expanded onClick={onFold} />
        </div>
    );
}

/*
 * The stack folded into one line: who asks, how many wait, and the first words of the front prompt.
 * The prompt still waits and still needs you; only the card is out of the way.
 */
function FoldedBar({ prompt, count, onGoTo, onOpen }: { prompt: CanvasPrompt; count: number; onGoTo(): void; onOpen(): void }) {
    const { t } = useTranslation('canvas');
    const status = useAskingStatus(prompt);
    const machine = useOwnerMachine(prompt.ownerId);
    return (
        <div className="flex min-w-0 items-center gap-2 px-3 py-2 text-xs text-text-muted">
            {status && <StatusDot status={status} />}
            <Tooltip label={t('promptStack.goToNode')}>
                <button type="button" className="max-w-40 shrink-0 truncate font-medium text-text hover:underline" onClick={onGoTo}>
                    {prompt.title}
                </button>
            </Tooltip>
            {count > 1 && (
                <Pill size="sm" className="shrink-0 tabular-nums">
                    {t('promptStack.waiting', { count })}
                </Pill>
            )}
            {/* The chevron is the keyboard's way in; this is the wide target for a pointer. */}
            <button type="button" tabIndex={-1} className="min-w-0 grow truncate text-left" onClick={onOpen}>
                {promptHeadline(prompt.subject)}
            </button>
            <SnoozeButton endpointId={machine} nodeId={prompt.ownerId} />
            <IconButton {...{ [FOLD_ATTRIBUTE]: '' }} icon={ChevronUp} size="xs" label={t('promptStack.open')} aria-expanded={false} onClick={onOpen} />
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
    const { prompts, snoozed } = useCanvasPrompts();
    const snoozedOpen = useSnoozedList((s) => s.openFor === viewId);
    const focusOwner = useSnoozedList((s) => (s.openFor === viewId ? s.focusOwner : null));
    const setSnoozedOpen = (open: boolean): void => useSnoozedList.getState().setOpen(viewId, open);
    const canvasStore = useCanvasStore();
    const disabled = useTransportStatus() !== 'open';
    const chatHost = useChatHost();
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
        const target = waiting.find((prompt) => asks(prompt, front.nodeId));
        if (target) {
            setActive(target.id);
            usePromptFold.getState().open(viewId);
            usePromptFront.getState().consume(front.seq);
            return;
        }
        // A snoozed node stays snoozed; the list says why its prompt is not in front, with the way back.
        const asleep = snoozed.find((prompt) => asks(prompt, front.nodeId));
        if (asleep) {
            useSnoozedList.getState().setOpen(viewId, true, asleep.ownerId);
            usePromptFront.getState().consume(front.seq);
        }
    }, [front, waiting, snoozed, setActive, viewId]);

    const folded = usePromptFold((s) => s.folded.has(viewId));
    const empty = waiting.length === 0;
    /* Whether this stack has shown a prompt; a stack that mounts reads nothing at first, which is no quiet moment. */
    const seenWaiting = useRef(false);
    // A fold lasts while something waits: what asks after a quiet moment is new, and arrives open.
    useEffect(() => {
        if (!empty) {
            seenWaiting.current = true;
            return;
        }
        if (seenWaiting.current) {
            seenWaiting.current = false;
            usePromptFold.getState().open(viewId);
        }
    }, [empty, viewId]);

    const noneSnoozed = snoozed.length === 0;
    // A list whose last row woke is gone, and stays closed for the next snooze.
    useEffect(() => {
        if (noneSnoozed) {
            useSnoozedList.getState().setOpen(viewId, false);
        }
    }, [noneSnoozed, viewId]);

    const snoozedMenu = !noneSnoozed && <SnoozedMenu snoozed={snoozed} open={snoozedOpen} focusOwner={focusOwner} onOpenChange={setSnoozedOpen} />;

    if (active === null) {
        return snoozedMenu ? (
            <StackPlace viewId={viewId} dockShown={dockShown}>
                <div data-holds-dock className="pointer-events-auto">
                    {snoozedMenu}
                </div>
            </StackPlace>
        ) : null;
    }

    const chatOrNodeId = active.sourceNodeId ?? active.subject.nodeId;
    // A later chat of a design asks from the design's node, which goes in front on that chat.
    const goTo = (): void => {
        focusNodeAction(viewId, designChatInFront(chatOrNodeId));
    };
    const reveal = (): void => {
        const nodeId = designChatInFront(chatOrNodeId);
        focusNodeAction(viewId, nodeId);
        canvasStore.getState().activateNode(nodeId);
    };
    const denyReason = active.subject.kind === 'chat' && providers.find((provider) => provider.kind === active.provider)?.capabilities.denyReason === true;
    const edges = Math.min(waiting.length - 1, 2);
    const step = (delta: number): void => {
        const next = waiting[index + delta];
        if (next) {
            // Folded, the keyboard stays on the bar's chevron, which outlives the change; there is no card to take it.
            if (!folded) {
                refocus.hold();
            }
            setActive(next.id);
        }
    };
    // Drawn at once, so the chevron of the other state is there to keep the keyboard.
    const setFolded = (next: boolean): void => {
        flushSync(() => {
            const fold = usePromptFold.getState();
            if (next) {
                fold.fold(viewId);
            } else {
                fold.open(viewId);
            }
        });
        container.current?.querySelector<HTMLElement>(`[${FOLD_ATTRIBUTE}]`)?.focus({ preventScroll: true });
    };

    return (
        <StackPlace viewId={viewId} dockShown={dockShown}>
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
                {folded ? (
                    <div className={`${PROMPT_SURFACE} focus-ring-within relative`}>
                        <FoldedBar prompt={active} count={waiting.length} onGoTo={goTo} onOpen={() => setFolded(false)} />
                    </div>
                ) : (
                    <>
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
                                            .act(active, () => answerPrompt(active.subject, action, PERSON_PROMPT_CLIENTS, chatHost))
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
                                    top={
                                        <SourceRow
                                            prompt={active}
                                            index={index}
                                            count={waiting.length}
                                            onStep={step}
                                            onGoTo={goTo}
                                            onFold={() => setFolded(true)}
                                        />
                                    }
                                />
                            </ErrorBoundary>
                        </div>
                    </>
                )}
                {snoozedMenu && <div className="absolute right-0 bottom-full mb-4">{snoozedMenu}</div>}
            </div>
        </StackPlace>
    );
}
