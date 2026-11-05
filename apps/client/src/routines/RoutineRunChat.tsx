import type { ChatSendExtras } from '@adecore/agents-react/chat';
import { Composer, Timeline } from '@adecore/agents-react/chat/ui';
import { useChatRow } from '@adecore/agents-react/state';
import { LazyBoundary, messageOf } from '@adecore/ui';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { perform } from '@/action-port/perform';
import { ConnectionNotice, NodeNotice } from '@/nodes/NodeNotice';
import { OutputChatContext } from '@/output/chat-scope';
import { useEndpointId } from '@/state/current-endpoint';
import { useTransportStatus } from '@/transport/status';
import { chatClientFor } from '@/workspace/connections';

const RETRY_FIRST_MS = 2000;
const RETRY_MAX_MS = 30_000;

// A run keeps the agent its routine names, so the composer never offers another one to switch to.
function keepProvider(): Promise<void> {
    return Promise.resolve();
}

/*
 * The chat of one run, drawn the way a chat view draws one. A run's chat is a hidden chat of the
 * project, so this only observes it: it never opens one, and a person still answers its questions here.
 */
export function RoutineRunChat({
    chatId,
    revision = '',
    composer = true,
    onContentHeight
}: {
    chatId: string;
    revision?: string;
    composer?: boolean;
    /* The thread's rows and padding once laid out, for a card that sizes itself to them. */
    onContentHeight?: (height: number) => void;
}) {
    const { t } = useTranslation('canvas');
    const endpointId = useEndpointId();
    const info = useChatRow(chatId, (row) => row?.info);
    const status = useTransportStatus();
    const [failure, setFailure] = useState<string | null>(null);
    /*
     * A run is on the list with its chat id before the outbox started that chat, so a first attach can
     * find no chat and the client never tries it again. Until the chat is read, a change of the run and
     * a growing pause try it again.
     */
    const [attempt, setAttempt] = useState(0);
    const [seenRevision, setSeenRevision] = useState(revision);
    const unread = info === undefined && status === 'open';
    if (revision !== seenRevision) {
        setSeenRevision(revision);
        if (unread) {
            setAttempt((count) => count + 1);
        }
    }

    useEffect(() => chatClientFor(endpointId)?.observe(chatId), [endpointId, chatId, attempt]);
    useEffect(() => {
        if (!unread) {
            return;
        }
        const timer = window.setTimeout(() => setAttempt((count) => count + 1), Math.min(RETRY_MAX_MS, RETRY_FIRST_MS * 2 ** attempt));
        return () => window.clearTimeout(timer);
    }, [attempt, unread]);

    const send = async (text: string, extras: ChatSendExtras): Promise<boolean> => {
        try {
            await perform('chat.send', { chatId, prompt: text, ...extras });
            return true;
        } catch (e) {
            setFailure(messageOf(e, t('chat.sendFailed')));
            return false;
        }
    };

    return (
        <div className="chat-column relative flex min-h-0 grow flex-col bg-surface">
            <ConnectionNotice status={status} />
            {failure !== null && (
                <NodeNotice tone="error" onRetry={() => setFailure(null)}>
                    {failure}
                </NodeNotice>
            )}
            <OutputChatContext value={chatId}>
                <LazyBoundary fallback={<div className="grow" />}>
                    <Timeline
                        chatId={chatId}
                        onContentHeight={onContentHeight}
                        composer={
                            composer &&
                            info && (
                                <Composer
                                    chatId={chatId}
                                    info={info}
                                    focused={false}
                                    disabled={status !== 'open'}
                                    providerFixed
                                    onSend={send}
                                    onRetarget={keepProvider}
                                />
                            )
                        }
                    />
                </LazyBoundary>
            </OutputChatContext>
        </div>
    );
}
