import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ChatAttachResult, ComputerApproval } from '@ruimte/contracts';
import { ButtonGroup, ErrorBoundary, IconButton, PreviewCard } from '@adecore/ui';
import { answerPrompt, type ChatPromptClients } from '@adecore/agents-react/prompts/logic/subjects';
import { usePromptSession } from '@adecore/agents-react/prompts/logic/usePromptSession';
import { PROMPT_SURFACE } from '@adecore/agents-react/prompts/ui/PromptCard';
import { PromptView } from '@adecore/agents-react/prompts/ui/PromptView';
import { ChatScopeContext } from '@adecore/agents-react/scope';
import { useChats, type ChatState } from '@adecore/agents-react/state/chats';
import { useProviders } from '@adecore/agents-react/state/providers';
import { PERSON_PROMPT_CLIENTS } from '@/actions/client-actions';
import { canvasPrompts, stackFront, type CanvasPrompt } from '@/canvas/prompts';
import { useComputer } from '@/state/computer';
import { endpointKey, useEndpointId } from '@/state/keys';
import { machineTransport } from '@/transport';
import { chatScopeOf } from '@/transport/chat-scope';
import { chatClientFor } from '@/transport/connections';
import { useEndpointConnection } from '@/transport/status';
import type { SidebarNode } from './sidebar-rows';

const NO_APPROVALS: readonly ComputerApproval[] = [];

function idOf(prompt: CanvasPrompt): string {
    return prompt.id;
}

function pick(waiting: readonly CanvasPrompt[], activeId: string | null, activeIndex: number): CanvasPrompt | null {
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
    reread(): void;
}

/*
 * What one chat or terminal asks, as the prompt stack would show it. A chat this window holds is read
 * from the store; any other is read from its machine, again whenever that machine says it changed.
 * A terminal's own question stays in its TUI, so a terminal only brings the cards about operating an app.
 */
function useWaitingPrompts(endpointId: string, node: SidebarNode): WaitingPrompts {
    const key = endpointKey(endpointId, node.id);
    const local = useEndpointId() === endpointId;
    const [held] = useState(() => node.kind === 'chat' && (chatClientFor(endpointId)?.isMounted(node.id) ?? false));
    const inspects = node.kind === 'chat' && !held;
    const heldChat = useChats((state) => (held ? state.byKey[key] : undefined));
    // The machine's cards are only answered through the workspace's own actions.
    const computer = useComputer((state) => (local ? (state.approvals[endpointId] ?? NO_APPROVALS) : NO_APPROVALS));
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
            sessions: {},
            chats: chat ? { [key]: chat } : {},
            computer,
            waitingSince: new Map()
        }).prompts;
    }, [inspects, read, chat, computer, endpointId, key, node.id, node.kind, node.title, node.provider]);

    return { prompts, failed: read?.failed ?? false, reread: () => setRevision((before) => before + 1) };
}

function CardBody({ endpointId, node, onOpen, onEmpty }: { endpointId: string; node: SidebarNode; onOpen(): void; onEmpty(): void }) {
    const { t } = useTranslation(['shell', 'canvas']);
    const local = useEndpointId() === endpointId;
    const { prompts, failed, reread } = useWaitingPrompts(endpointId, node);
    const disabled = useEndpointConnection(endpointId).status !== 'open';
    const providers = useProviders((row) => row.providers);
    const session = usePromptSession({ prompts: prompts ?? [], idOf, pick, disabled });
    const { active, waiting, index, setActive } = session;

    useEffect(() => {
        if (prompts !== null && waiting.length === 0) {
            onEmpty();
        }
    }, [prompts, waiting.length, onEmpty]);

    if (active === null) {
        return <p className="px-3 py-2 text-sm text-text-muted">{failed ? t('sidebar.promptFailed') : t('sidebar.promptLoading')}</p>;
    }

    const denyReason = active.subject.kind === 'chat' && providers.find((provider) => provider.kind === active.provider)?.capabilities.denyReason === true;
    const clients = local ? PERSON_PROMPT_CLIENTS : clientsOn(endpointId);
    const step = (delta: number): void => {
        const next = waiting[index + delta];
        if (next) {
            setActive(next.id);
        }
    };

    return (
        <ErrorBoundary label={t('canvas:promptStack.failed')} resetKeys={[active.id]} className="relative p-3">
            <PromptView
                key={active.id}
                subject={active.subject}
                draft={session.draftOf(active.id)}
                onDraft={(draft) => session.setDraft(active.id, draft)}
                onAction={(action) => {
                    void session
                        .act(active, () => answerPrompt(active.subject, action, clients))
                        .then((result) => {
                            if (result === 'sent') {
                                reread();
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
                    <div className="flex h-[39px] min-w-0 shrink-0 items-center gap-2 border-b border-dashed border-border pl-2.5 pr-1 text-xs text-text-muted">
                        <button type="button" className="min-w-0 truncate font-medium text-text hover:underline" onClick={onOpen}>
                            {node.title}
                        </button>
                        <span className="grow" />
                        {waiting.length > 1 && (
                            <ButtonGroup render={<span />} className="shrink-0">
                                <IconButton
                                    icon={ChevronLeft}
                                    size="sm"
                                    label={t('canvas:promptStack.previous')}
                                    disabled={index === 0}
                                    onClick={() => step(-1)}
                                />
                                <span className="px-1 tabular-nums">{t('canvas:promptStack.position', { index: index + 1, count: waiting.length })}</span>
                                <IconButton
                                    icon={ChevronRight}
                                    size="sm"
                                    label={t('canvas:promptStack.next')}
                                    disabled={index === waiting.length - 1}
                                    onClick={() => step(1)}
                                />
                            </ButtonGroup>
                        )}
                    </div>
                }
            />
        </ErrorBoundary>
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
    const close = useCallback(() => setOpen(false), []);
    return (
        <PreviewCard.Root open={open && (node.kind === 'chat' || asksForApp)} onOpenChange={setOpen}>
            <PreviewCard.Trigger delay={300} closeDelay={200} render={<div />}>
                {children}
            </PreviewCard.Trigger>
            <PreviewCard.Popup variant="plain" side="right" align="start" sideOffset={12} className={`${PROMPT_SURFACE} w-96`}>
                <ChatScopeContext.Provider value={chatScopeOf(endpointId)}>
                    <CardBody endpointId={endpointId} node={node} onOpen={onOpen} onEmpty={close} />
                </ChatScopeContext.Provider>
            </PreviewCard.Popup>
        </PreviewCard.Root>
    );
}
