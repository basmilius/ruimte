import { useEffect, useRef, useState } from 'react';
import i18next from 'i18next';
import { useTranslation } from 'react-i18next';
import type { AgentKind, ModelSelection } from '@ruimte/contracts';
import { perform } from '@/actions/client-actions';
import type { ChatSendExtras } from '@adecore/agents-react/chat';
import { providersOf, useChats, useChatRow } from '@adecore/agents-react/state';
import {
    defaultProvider,
    readChatPreferences,
    selectionFor,
    startingSelection,
    rememberChatSelection,
    composerWrites,
    useSubagentTrail
} from '@adecore/agents-react/chat';
import { peekOpeningMode, settleOpeningMode } from '@/chat/opening-mode';
import { deriveNodeTitle } from '@/chat/title';
import { Composer, SubagentTimeline, Timeline } from '@adecore/agents-react/chat/ui';
import { useProject } from '@/state/project';
import { endpointKey, useEndpointId } from '@/state/keys';
import { chatClientFor } from '@/transport/connections';
import { useTransportStatus } from '@/transport/status';
import { MissingProviderNote } from '@/nodes/MissingProviderNote';
import { OutputChatContext } from '@/output/chat-scope';
import { ConnectionNotice, NodeNotice } from '@/nodes/NodeNotice';
import { useMountCount } from '@/measure/mounts';
import { readNodeHost, renameHost, useNodeHost, useSuggestedTitle } from '@/nodes/node-host';
import { ErrorBoundary, LazyBoundary, messageOf } from '@adecore/ui';
import { bringPromptToFront } from '@/canvas/prompt-stack';
import { PROMPTS_IN_NODES } from '@/prompts/placement';
import { ChatViewPetMount } from '@/pets/ViewPetMounts';

/*
 * The body of a chat, the same on a canvas inside a frame and filling a view of its own. In a view its
 * pet stands on the composer (`pet`), since no node frame is there to carry it.
 */
export function ChatBody({ id, focused, onCanvas = false, pet }: { id: string; focused: boolean; onCanvas?: boolean; pet?: { title: string | undefined } }) {
    useMountCount('chat');
    const { t } = useTranslation('canvas');
    const info = useChatRow(id, (row) => row?.info);
    const nodeHost = useNodeHost(id);
    const providerFixed = nodeHost?.providerFixed === true;
    useSuggestedTitle(id, info?.suggestedTitle);
    const status = useTransportStatus();
    const endpointId = useEndpointId();
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
            providerFixed={providerFixed}
            onSend={send}
            onRetarget={retarget}
        />
    );

    return (
        <div className="relative flex h-full flex-col bg-surface">
            <ConnectionNotice status={status} />
            {status === 'open' && !failure && <MissingProviderNote endpointId={endpointId} kind={info?.provider ?? nodeHost?.provider} />}
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
            <OutputChatContext value={id}>
                <LazyBoundary fallback={<div className="grow" />}>
                    <Timeline
                        chatId={id}
                        composer={
                            composer &&
                            (pet === undefined ? (
                                composer
                            ) : (
                                <div className="relative">
                                    <ChatViewPetMount id={id} title={pet.title} />
                                    {composer}
                                </div>
                            ))
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
            </OutputChatContext>
        </div>
    );
}
