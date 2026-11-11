import type { ChatSendExtras } from '@adecore/agents-react/chat';
import {
    defaultProvider,
    readChatPreferences,
    selectionFor,
    startingSelection,
    rememberChatSelection,
    composerWrites,
    useSubagentTrail
} from '@adecore/agents-react/chat';
import { Composer, SubagentTimeline, Timeline } from '@adecore/agents-react/chat/ui';
import { providersOf, useChats, useChatRow } from '@adecore/agents-react/state';
import { ErrorBoundary, Icon, LazyBoundary, messageOf } from '@adecore/ui';
import { deriveNodeTitle, type AgentKind, type ModelSelection } from '@ruimte/contracts';
import i18next from 'i18next';
import { MessageSquare } from 'lucide-react';
import { Activity, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { peekOpeningMode, settleOpeningMode } from '@/action-port/opening-mode';
import { perform } from '@/action-port/perform';
import { ViewAccessories } from '@/extensions/ContributedSlots';
import { nodeInfoOf } from '@/extensions/slots';
import { SlotRow } from '@/extensions/SlotSurfaces';
import { ChatViewAccessory } from '@/extensions/ViewAccessorySlot';
import { useMountCount } from '@/measure/mounts';
import { MissingProviderNote } from '@/nodes/MissingProviderNote';
import { OutputChatContext } from '@/output/chat-scope';
import { PROMPTS_IN_NODES } from '@/prompts/placement';
import { DEFAULT_CHAT_TEXT_SIZE, useChatTextSizes } from '@/state/chat-text-size';
import { useEndpointId } from '@/state/current-endpoint';
import { endpointKey } from '@/state/keys';
import { useProject } from '@/state/project';
import { bringPromptToFront } from '@/surface/canvas/prompt-stack';
import { ChatOnCanvasContext } from '@/surface/nodes/chat-on-canvas';
import { readNodeHost, renameHost, useNodeHost, useSuggestedTitle } from '@/surface/nodes/node-host';
import { ConnectionNotice, NodeNotice } from '@/surface/nodes/NodeNotice';
import { useTransportStatus } from '@/transport/status';
import { chatClientFor } from '@/workspace/connections';

/*
 * The body of a chat, the same on a canvas inside a frame and filling a view of its own. In a view what a built-in
 * adds stands on the composer (`accessories`), since no node frame is there to carry it. A chat node's workflows
 * stand beside it on the canvas (`workflowsBeside`), so its composer draws no pill for them.
 */
export function ChatBody({
    id,
    focused,
    onCanvas = false,
    workflowsBeside = false,
    visible = true,
    accessories
}: {
    id: string;
    focused: boolean;
    onCanvas?: boolean;
    workflowsBeside?: boolean;
    visible?: boolean;
    accessories?: { title: string | undefined };
}) {
    useMountCount('chat');
    const { t } = useTranslation('canvas');
    const info = useChatRow(id, (row) => row?.info);
    const nodeHost = useNodeHost(id);
    const providerFixed = nodeHost?.providerFixed === true;
    useSuggestedTitle(id, info?.suggestedTitle);
    const status = useTransportStatus();
    const endpointId = useEndpointId();
    const textSize = useChatTextSizes((state) => state.byKey[endpointKey(endpointId, id)] ?? DEFAULT_CHAT_TEXT_SIZE);
    const [failure, setFailure] = useState<string | null>(null);
    const [generation, setGeneration] = useState(0);
    const switched = useRef<Promise<void>>(Promise.resolve());
    const { trail } = useSubagentTrail(id);
    const shown = trail.at(-1);

    useEffect(() => {
        // Taken once, so a node that leaves after the window moved to another machine still detaches from its own.
        const chats = chatClientFor(endpointId);
        if (!chats) {
            return;
        }
        let cancelled = false;
        const host = readNodeHost(id);
        const preferences = readChatPreferences();
        // A node without a provider of its own opens on the CLI whose model was picked last.
        const provider = host?.provider ?? defaultProvider(preferences) ?? undefined;
        const catalog = providersOf(endpointId).providers.find((entry) => entry.kind === provider);
        chats
            .open(id, {
                provider,
                account: host?.account,
                cwd: host?.cwd ?? useProject.getState().current?.folder ?? undefined,
                resume: host?.resume,
                selection: (catalog === undefined ? selectionFor(preferences, provider) : startingSelection(preferences, catalog)) ?? undefined,
                runtimeMode: peekOpeningMode(endpointId, id) ?? preferences.runtimeMode
            })
            .then((opened) => {
                if (opened && !cancelled) {
                    settleOpeningMode(endpointId, id);
                }
            })
            .catch((e: unknown) => {
                if (!cancelled) {
                    // Not the hook's `t`: the effect would then depend on it and reopen the chat on a language change.
                    setFailure(messageOf(e, i18next.t('canvas:chat.openFailed')));
                }
            });
        return () => {
            cancelled = true;
            void chats.detach(id);
        };
    }, [endpointId, id, generation]);

    // The chat is gone on the machine until it opened again on the other CLI, so a send or another switch meanwhile waits for that.
    const retarget = (provider: AgentKind, selection: ModelSelection): Promise<void> => {
        const changed = switched.current.then(() => perform('chat.setProvider', { chatId: id, provider, model: null, selection })).then(() => undefined);
        switched.current = changed.catch((e: unknown) => setFailure(messageOf(e, t('chat.retargetFailed'))));
        return changed;
    };

    /* Whether the machine took the message, which a send that also opens a new chat waits for. */
    const send = (text: string, extras: ChatSendExtras): Promise<boolean> => {
        const host = readNodeHost(id);
        const title = deriveNodeTitle(text);
        // The prompt that opens a chat names it, once, until the CLI's own name for the session
        // arrives. A rename by a person ends both for good.
        if (host && !host.titleSource && title) {
            renameHost(id, title, 'auto');
        }
        return switched.current
            .then(async () => {
                // An older chat may use a different model from the last picker choice.
                const info = useChats.getState().byKey[endpointKey(endpointId, id)]?.info;
                await perform('chat.send', { chatId: id, prompt: text, ...extras });
                if (info !== undefined) {
                    rememberChatSelection(info.provider, info.selection);
                }
                return true;
            })
            .catch((e: unknown) => {
                setFailure(messageOf(e, t('chat.sendFailed')));
                return false;
            });
    };

    const composer = info && (
        <Composer
            chatId={id}
            info={info}
            focused={focused}
            answerPromptsElsewhere={onCanvas && !PROMPTS_IN_NODES ? () => bringPromptToFront(id) : undefined}
            disabled={status !== 'open'}
            readOnly={!composerWrites(trail)}
            workflowPill={!workflowsBeside}
            providerFixed={providerFixed}
            onSend={send}
            onRetarget={retarget}
        />
    );

    return (
        <div className="chat-reading-scope h-full min-h-0" data-chat-body={id} data-chat-text-size={textSize}>
            <div className="chat-reading-content relative flex h-full flex-col bg-surface" data-surface="chat">
                <ConnectionNotice status={status} />
                {status === 'open' && !failure && <MissingProviderNote endpointId={endpointId} kind={info?.provider ?? nodeHost?.provider} chatId={id} />}
                {failure && (
                    <NodeNotice
                        tone="error"
                        onRetry={() => {
                            setFailure(null);
                            setGeneration((g) => g + 1);
                        }}
                    >
                        {failure}
                    </NodeNotice>
                )}
                <SlotRow
                    place="threadHeader"
                    context={{ chat: { id }, node: nodeInfoOf(id) }}
                    words
                    wrap={(row) => <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border px-2 py-1">{row}</div>}
                />
                <OutputChatContext value={id}>
                    <Activity mode={visible ? 'visible' : 'hidden'}>
                        <LazyBoundary fallback={<div className="grow" />}>
                            <Timeline
                                chatId={id}
                                composer={
                                    composer && (
                                        <div className="relative">
                                            {accessories !== undefined && <ViewAccessories on="chat" id={id} title={accessories.title} />}
                                            {accessories !== undefined && <ChatViewAccessory id={id} />}
                                            <SlotRow
                                                place="composer"
                                                words
                                                context={{ chat: { id }, node: nodeInfoOf(id) }}
                                                wrap={(row) => <div className="flex flex-wrap items-center gap-1 px-2 pb-1">{row}</div>}
                                            />
                                            <ChatOnCanvasContext value={onCanvas}>{composer}</ChatOnCanvasContext>
                                        </div>
                                    )
                                }
                                overlay={
                                    shown && (
                                        <ErrorBoundary key={shown.toolUseId} label={t('chat.conversationFailed')} resetKeys={[shown.toolUseId]}>
                                            <SubagentTimeline chatId={id} toolUseId={shown.toolUseId} />
                                        </ErrorBoundary>
                                    )
                                }
                            />
                        </LazyBoundary>
                    </Activity>
                    {!visible && (
                        <div className="flex min-h-0 w-full grow items-center justify-center gap-2 px-4 text-text-faint" aria-hidden="true">
                            <Icon icon={MessageSquare} size={20} />
                            <span className="truncate text-sm">{nodeHost?.title ?? id}</span>
                        </div>
                    )}
                </OutputChatContext>
            </div>
        </div>
    );
}
