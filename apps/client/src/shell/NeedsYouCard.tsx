import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ChatAttachResult, ComputerApproval, ProjectProposal, SecretRequest } from '@ruimte/contracts';
import { Button, ButtonGroup, ErrorBoundary, IconButton, PreviewCard } from '@adecore/ui';
import {
    answerPrompt,
    promptCreatedAt,
    type ChatPromptClients,
    useFocusAfterAnswer,
    usePromptSession,
    PROMPT_SURFACE,
    PromptView
} from '@adecore/agents-react/prompts';
import { ChatScopeContext, useChatHost } from '@adecore/agents-react';
import { Markdown } from '@adecore/agents-react/chat/ui';
import { useChats, type ChatState, useProviders } from '@adecore/agents-react/state';
import { PERSON_PROMPT_CLIENTS } from '@/actions/client-actions';
import { canvasPrompts, stackFront, type CanvasPrompt } from '@/canvas/prompts';
import { useComputer } from '@/state/computer';
import { useProposals } from '@/state/proposals';
import { useSecrets } from '@/state/secrets';
import { endpointKey, useEndpointId } from '@/state/keys';
import { useSessions } from '@/state/sessions';
import { useWaitingSince, type WaitDetails } from '@/state/waiting';
import { machineTransport } from '@/transport';
import { chatScopeOf } from '@/transport/chat-scope';
import { chatClientFor } from '@/transport/connections';
import { useEndpointConnection } from '@/transport/status';
import type { SidebarNode } from './sidebar-rows';
import { WaitAge } from '@/attention/WaitLabel';

const NO_APPROVALS: readonly ComputerApproval[] = [];
const EXCERPT_LENGTH = 280;
const EXCERPT_LINES = 4;
const NO_SECRETS: readonly SecretRequest[] = [];
const NO_PROPOSALS: readonly ProjectProposal[] = [];

function idOf(prompt: CanvasPrompt): string {
    return prompt.id;
}

function pick(waiting: readonly CanvasPrompt[], activeId: string | null, activeIndex: number, preferredKind?: WaitDetails['kind']): CanvasPrompt | null {
    if (!waiting.some((prompt) => prompt.id === activeId)) {
        const preferred = waiting.find((prompt) => (prompt.subject.kind === 'chat' ? prompt.subject.item.kind : prompt.subject.prompt.asks) === preferredKind);

        if (preferred !== undefined) {
            return preferred;
        }
    }

    const id = stackFront(waiting.map(idOf), activeId, activeIndex);
    return waiting.find((prompt) => prompt.id === id) ?? null;
}

/* The workspace's actions only reach the machine it runs on, so a chat on another machine is answered on that machine's own link. */
function clientsOn(endpointId: string): ChatPromptClients {
    const transport = machineTransport(endpointId);
    return {
        approve: async (chatId, requestId, decision, message) => {
            await transport.request('chat.approve', { chatId, requestId, decision, ...(message === undefined ? {} : { message }) });
        },
        answer: async (chatId, requestId, answers) => {
            await transport.request('chat.answer', { chatId, requestId, answers });
        },
        dismiss: async (chatId, itemId) => {
            await transport.request('chat.dismiss', { chatId, itemId });
        }
    };
}

/* Enough of a chat for its prompts: every item that came with the read, the requests from before its page among them. */
function chatOf(result: ChatAttachResult): ChatState {
    const byId = Object.fromEntries([...(result.pending ?? []), ...result.items].map((item) => [item.id, item]));
    return { info: result.info, items: byId, structure: byId, order: Object.keys(byId) };
}

interface WaitingPrompts {
    /* Null until the chat was read. */
    prompts: CanvasPrompt[] | null;
    failed: boolean;
    lastText: string | null;
    reread(): void;
}

/* Existing words only: the queue adds no model turn to summarize a finished turn. */
function lastTextOf(chat: ChatState | undefined): string | null {
    for (const id of [...(chat?.order ?? [])].reverse()) {
        const item = chat?.items[id];
        const text = item?.kind === 'assistant' && !item.parentToolUseId ? item.text : item?.kind === 'note' && item.level === 'error' ? item.text : '';
        const trimmed = text.trim();

        if (trimmed) {
            return trimmed;
        }
    }

    return null;
}

function QueueExcerpt({ text }: { text: string }) {
    const { t } = useTranslation('shell');
    const [expanded, setExpanded] = useState(false);
    const long = text.length > EXCERPT_LENGTH || text.split('\n').length > EXCERPT_LINES;

    return (
        <div className="text-sm text-text-muted">
            <div className={long && !expanded ? 'max-h-24 overflow-hidden' : ''}>
                <Markdown text={text} fileLinks={false} />
            </div>
            {long && (
                <button type="button" className="mt-1 text-xs text-text hover:underline" onClick={() => setExpanded((before) => !before)}>
                    {t(expanded ? 'attention.showLess' : 'attention.showMore')}
                </button>
            )}
        </div>
    );
}

/*
 * What one chat or terminal asks, as the prompt stack would show it. A chat this window holds is read
 * from the store; any other is read from its machine, again whenever that machine says it changed.
 * A terminal's hooks carry the request to read here; its TUI still takes the answer.
 */
function useWaitingPrompts(endpointId: string, node: SidebarNode): WaitingPrompts {
    const key = endpointKey(endpointId, node.id);
    const session = useSessions((state) => (node.kind === 'terminal' ? state.byKey[key] : undefined));
    const since = useWaitingSince((state) => state.byKey.get(key));
    const local = useEndpointId() === endpointId;
    // A design's row stands for its own chat, under the node's id.
    const isChat = node.kind === 'chat' || node.kind === 'design';
    const [held] = useState(() => isChat && (chatClientFor(endpointId)?.isMounted(node.id) ?? false));
    const inspects = isChat && !held;
    const heldChat = useChats((state) => (held ? state.byKey[key] : undefined));
    // The machine's cards are only answered through the workspace's own actions.
    const computer = useComputer((state) => (local ? (state.approvals[endpointId] ?? NO_APPROVALS) : NO_APPROVALS));
    const secrets = useSecrets((state) => state.requests[endpointId] ?? NO_SECRETS);
    // Review opens the dialog of this window, so only the machine it works on is reviewed here.
    const proposals = useProposals((state) => (local ? (state.proposals[endpointId] ?? NO_PROPOSALS) : NO_PROPOSALS));
    const [read, setRead] = useState<{ chat: ChatState | null; failed: boolean } | null>(null);
    const [revision, setRevision] = useState(0);

    useEffect(() => {
        if (!inspects) {
            return;
        }
        return machineTransport(endpointId).on('chat.status', ({ chatId }) => {
            if (chatId === node.id) {
                setRevision((before) => before + 1);
            }
        });
    }, [inspects, endpointId, node.id]);

    useEffect(() => {
        if (!inspects) {
            return;
        }
        let alive = true;
        const client = chatClientFor(endpointId);
        const reading = client === null ? Promise.reject(new Error('The machine is no longer known.')) : client.inspect(node.id);
        reading.then(
            (result) => {
                if (alive) {
                    setRead({ chat: chatOf(result), failed: false });
                }
            },
            () => {
                if (alive) {
                    setRead((before) => ({ chat: before?.chat ?? null, failed: true }));
                }
            }
        );
        return () => {
            alive = false;
        };
    }, [inspects, endpointId, node.id, revision]);

    const chat = held ? heldChat : (read?.chat ?? undefined);
    const prompts = useMemo(() => {
        if (inspects && read === null) {
            return null;
        }
        return canvasPrompts({
            nodes: [{ id: node.id, kind: node.kind, title: node.title, provider: node.provider ?? undefined }],
            endpointId,
            sessions: session ? { [key]: session } : {},
            chats: chat ? { [key]: chat } : {},
            computer,
            secrets,
            proposals,
            waitingSince: new Map(since === undefined ? [] : [[key, since]])
        }).prompts;
    }, [inspects, read, chat, session, since, computer, secrets, proposals, endpointId, key, node.id, node.kind, node.title, node.provider]);

    return { prompts, failed: read?.failed ?? false, lastText: lastTextOf(chat), reread: () => setRevision((before) => before + 1) };
}

export function WaitingPrompt({
    endpointId,
    node,
    onOpen,
    onEmpty,
    onFocusEmpty,
    onSent,
    summary = false,
    completed = false,
    preferredKind
}: {
    endpointId: string;
    node: SidebarNode;
    onOpen?(): void;
    onEmpty?(): void;
    onFocusEmpty?(): void;
    onSent?(): void;
    summary?: boolean;
    completed?: boolean;
    preferredKind?: WaitDetails['kind'];
}) {
    const { t } = useTranslation(['shell', 'canvas']);
    const local = useEndpointId() === endpointId;
    const { prompts, failed, lastText, reread } = useWaitingPrompts(endpointId, node);
    const disabled = useEndpointConnection(endpointId).status !== 'open';
    const chatHost = useChatHost();
    const providers = useProviders((row) => row.providers);
    const session = usePromptSession({
        prompts: prompts ?? [],
        idOf,
        pick: (waiting, activeId, activeIndex) => pick(waiting, activeId, activeIndex, preferredKind),
        disabled
    });
    const { active, waiting, index, setActive } = session;
    const container = useRef<HTMLDivElement | null>(null);
    const refocus = useFocusAfterAnswer(active?.id ?? null, container, () => onFocusEmpty?.());

    useEffect(() => {
        if (prompts !== null && waiting.length === 0) {
            onEmpty?.();
        }
    }, [prompts, waiting.length, onEmpty]);

    if (active === null) {
        if (completed && prompts !== null) {
            return (
                <div className="space-y-3 p-3">
                    <h3 className="min-w-0 break-words text-sm font-medium text-text">{node.title}</h3>
                    {lastText ? (
                        <QueueExcerpt text={lastText} />
                    ) : (
                        <p className="text-sm text-text-muted">
                            {t(node.kind === 'terminal' ? 'attention.terminalFinished' : failed ? 'sidebar.promptFailed' : 'attention.noExcerpt')}
                        </p>
                    )}
                    {failed && <Button onClick={reread}>{t('common:action.retry')}</Button>}
                    {onOpen && <Button onClick={onOpen}>{t('attention.openSession')}</Button>}
                </div>
            );
        }

        return (
            <div className="space-y-3 p-3">
                <p className="text-sm text-text-muted">
                    {failed
                        ? t('sidebar.promptFailed')
                        : prompts === null
                          ? t('sidebar.promptLoading')
                          : t(onOpen ? 'attention.openToAnswer' : 'attention.previewUnavailable')}
                </p>
                {failed && <Button onClick={reread}>{t('common:action.retry')}</Button>}
                {onOpen && <Button onClick={onOpen}>{t('attention.openSession')}</Button>}
            </div>
        );
    }

    const denyReason = active.subject.kind === 'chat' && providers.find((provider) => provider.kind === active.provider)?.capabilities.denyReason === true;
    const clients = local ? PERSON_PROMPT_CLIENTS : clientsOn(endpointId);
    const step = (delta: number): void => {
        const next = waiting[index + delta];
        if (next) {
            setActive(next.id);
        }
    };
    const stepper = waiting.length > 1 && (
        <ButtonGroup render={<span />} className="shrink-0">
            <IconButton icon={ChevronLeft} size="sm" label={t('canvas:promptStack.previous')} disabled={index === 0} onClick={() => step(-1)} />
            <span className="px-1 tabular-nums">{t('canvas:promptStack.position', { index: index + 1, count: waiting.length })}</span>
            <IconButton icon={ChevronRight} size="sm" label={t('canvas:promptStack.next')} disabled={index === waiting.length - 1} onClick={() => step(1)} />
        </ButtonGroup>
    );

    return (
        <div ref={container}>
            {summary && (
                <div className="space-y-3 px-3 pt-3">
                    <div className="flex min-w-0 items-start gap-2 text-xs text-text-muted">
                        <h3 className="min-w-0 grow break-words text-sm font-medium text-text">{node.title}</h3>
                        {stepper}
                        {onOpen && <IconButton icon={ExternalLink} size="sm" label={t('attention.openSession')} onClick={onOpen} />}
                    </div>
                    {lastText && <QueueExcerpt text={lastText} />}
                </div>
            )}
            <ErrorBoundary label={t('canvas:promptStack.failed')} resetKeys={[active.id]} className="relative p-3">
                <PromptView
                    key={active.id}
                    subject={active.subject}
                    draft={session.draftOf(active.id)}
                    onDraft={(draft) => session.setDraft(active.id, draft)}
                    onAction={(action) => {
                        refocus.hold();

                        void session
                            .act(active, () => answerPrompt(active.subject, action, clients, chatHost))
                            .then((result) => {
                                if (result === 'sent') {
                                    reread();
                                    onSent?.();
                                } else {
                                    refocus.release();
                                }
                            });
                    }}
                    onReveal={onOpen}
                    more={0}
                    hasDraft={false}
                    denyReason={denyReason}
                    disabled={disabled}
                    sending={session.sending}
                    error={session.errorOf(active.id)}
                    top={
                        summary ? undefined : (
                            <div className="flex h-[39px] min-w-0 shrink-0 items-center gap-2 border-b border-dashed border-border pl-2.5 pr-1 text-xs text-text-muted">
                                {onOpen ? (
                                    <button type="button" className="min-w-0 truncate font-medium text-text hover:underline" onClick={onOpen}>
                                        {node.title}
                                    </button>
                                ) : (
                                    <span className="min-w-0 truncate font-medium text-text">{node.title}</span>
                                )}
                                <span className="grow" />
                                <WaitAge since={promptCreatedAt(active.subject)} />
                                {stepper}
                            </div>
                        )
                    }
                />
            </ErrorBoundary>
        </div>
    );
}

/*
 * A "Needs you" row that shows what it asks while the pointer rests on it, so a question or an
 * approval is answered from the sidebar without opening the view it lives in.
 */
export function NeedsYouCard({ endpointId, node, onOpen, children }: { endpointId: string; node: SidebarNode; onOpen(): void; children: ReactNode }) {
    const local = useEndpointId() === endpointId;
    const asksForApp = useComputer((state) => local && (state.approvals[endpointId] ?? NO_APPROVALS).some((approval) => approval.nodeId === node.id));
    const [open, setOpen] = useState(false);
    const close = () => setOpen(false);
    return (
        <PreviewCard.Root open={open && (node.kind === 'chat' || node.kind === 'design' || asksForApp)} onOpenChange={setOpen}>
            <PreviewCard.Trigger delay={300} closeDelay={200} render={<div />}>
                {children}
            </PreviewCard.Trigger>
            <PreviewCard.Popup variant="plain" side="right" align="start" sideOffset={12} className={`${PROMPT_SURFACE} w-96`}>
                <ChatScopeContext.Provider value={chatScopeOf(endpointId)}>
                    <WaitingPrompt endpointId={endpointId} node={node} onOpen={onOpen} onEmpty={close} preferredKind={node.wait?.kind} />
                </ChatScopeContext.Provider>
            </PreviewCard.Popup>
        </PreviewCard.Root>
    );
}
