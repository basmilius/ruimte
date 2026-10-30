import { useEffect, useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { ChatScopeContext } from '@adecore/agents-react';
import { useChats } from '@adecore/agents-react/state';
import { isHiddenChatView } from '@ruimte/contracts';
import { Button, Dialog, IconButton } from '@adecore/ui';
import { X } from 'lucide-react';
import { bringPromptToFront } from '@/canvas/prompt-stack';
import { projectNodes, useProjectNodes, type ProjectNodeRef } from '@/project/view-nodes';
import { revealNode } from '@/project/views';
import { WaitingPrompt } from '@/shell/NeedsYouCard';
import type { SidebarNode } from '@/shell/sidebar-rows';
import { waitAskLine } from '@/shell/wait-ask';
import { groupAttention, useAttention } from '@/state/attention';
import { endpointKey, endpointOfNode, useEndpointId } from '@/state/keys';
import { useProject } from '@/state/project';
import { useDocument } from '@/state/document';
import { nodeProvider, nodeStatus, useSessions } from '@/state/sessions';
import { useSnoozes } from '@/state/snooze';
import { compareWaits, useWaitingSince, waitDetailsOf } from '@/state/waiting';
import { chatScopeOf } from '@/transport/chat-scope';
import { closeAttentionQueue, useAttentionQueue } from './queue';
import { WaitLabel } from './WaitLabel';

function QueueBody({ initialFocus }: { initialFocus: RefObject<HTMLButtonElement | null> }) {
    const { t } = useTranslation('shell');
    const endpointId = useEndpointId();
    const nodes = useProjectNodes();
    const sessions = useSessions((state) => state.byKey);
    const chats = useChats((state) => state.statusByKey);
    const unseen = useAttention((state) => state.unseen);
    const snoozes = useSnoozes((state) => state.byKey);
    const since = useWaitingSince((state) => state.byKey);
    const [selected, setSelected] = useState<string | null>(null);
    const views = useDocument((state) => state.views);

    const groups = groupAttention(nodes, sessions, chats, endpointId, unseen, snoozes);
    const waiting = new Set(groups.needsYou);
    const finished = new Set(groups.finished);
    const details = new Map(nodes.map((node) => [node.id, waitDetailsOf(node, sessions, chats, since, endpointId)]));
    const asks = nodes.filter((node) => waiting.has(node.id)).sort((before, next) => compareWaits(details.get(before.id), details.get(next.id)));
    const completed = nodes
        .filter((node) => finished.has(node.id))
        .sort(
            (before, next) =>
                Number(nodeStatus(next, sessions, chats, endpointId) === 'error') - Number(nodeStatus(before, sessions, chats, endpointId) === 'error')
        );
    const entries = [...asks, ...completed];
    const active = entries.find((node) => node.id === selected) ?? entries[0] ?? null;
    const machine = active === null ? endpointId : endpointOfNode(active, endpointId);
    const hidden = active !== null && views.some((view) => view.id === active.id && isHiddenChatView(view));
    const preview: SidebarNode | null =
        active === null
            ? null
            : {
                  id: active.id,
                  title: active.title,
                  kind: active.kind,
                  provider: nodeProvider(active, chats, endpointId) ?? null,
                  status: nodeStatus(active, sessions, chats, endpointId) ?? null,
                  draft: false
              };

    const openSession = (): void => {
        if (active !== null && projectNodes().some((node) => node.id === active.id)) {
            closeAttentionQueue();
            revealNode(active.id);
            bringPromptToFront(active.id);
        }
    };

    const row = (node: ProjectNodeRef, waits: boolean) => {
        const detail = details.get(node.id);
        const ask = detail?.ask;

        return (
            <Button
                key={node.id}
                ref={active?.id === node.id ? initialFocus : undefined}
                className={`h-auto w-full flex-col items-stretch gap-1 px-3 py-2 text-left ${active?.id === node.id ? 'bg-surface-hover text-text' : ''}`}
                aria-pressed={active?.id === node.id}
                onClick={() => setSelected(node.id)}
            >
                <span className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 grow truncate">{node.title}</span>
                    {waits ? (
                        <WaitLabel detail={detail} />
                    ) : (
                        <span className="text-xs text-text-muted">
                            {t(nodeStatus(node, sessions, chats, endpointId) === 'error' ? 'attention.error' : 'attention.finished')}
                        </span>
                    )}
                </span>
                {waits && ask && <span className="truncate text-xs text-text-muted">{waitAskLine(ask)}</span>}
            </Button>
        );
    };

    if (entries.length === 0) {
        return <p className="py-6 text-sm text-text-muted">{t('attention.empty')}</p>;
    }

    return (
        <div className="mt-4 grid min-h-0 gap-4 md:grid-cols-[16rem_minmax(0,1fr)]">
            <div className={`max-h-60 overflow-auto md:max-h-96 ${selected === null ? '' : 'hidden md:block'}`}>
                {asks.length > 0 && (
                    <>
                        <p className="px-3 py-2 text-xs font-medium text-text-muted">{t('attention.waiting')}</p>
                        {asks.map((node) => row(node, true))}
                    </>
                )}
                {completed.length > 0 && (
                    <>
                        <p className="px-3 py-2 text-xs font-medium text-text-muted">{t('attention.finishedUnseen')}</p>
                        {completed.map((node) => row(node, false))}
                    </>
                )}
            </div>
            <div className={`min-w-0 max-h-96 overflow-auto rounded-md border border-border ${selected === null ? 'hidden md:block' : ''}`}>
                <Button className="m-2 md:hidden" onClick={() => setSelected(null)}>
                    {t('attention.backToList')}
                </Button>
                {preview && (
                    <ChatScopeContext.Provider value={chatScopeOf(machine)}>
                        <WaitingPrompt
                            key={endpointKey(machine, preview.id)}
                            endpointId={machine}
                            node={preview}
                            onOpen={hidden ? undefined : openSession}
                            summary
                            completed={!waiting.has(preview.id)}
                        />
                    </ChatScopeContext.Provider>
                )}
            </div>
        </div>
    );
}

export function AttentionQueue() {
    const { t } = useTranslation('shell');
    const projectKey = useAttentionQueue((state) => state.projectKey);
    const project = useProject((state) => state.current);
    const endpointId = useEndpointId();
    const initialFocus = useRef<HTMLButtonElement | null>(null);
    const currentKey = project === null ? null : endpointKey(endpointId, project.projectId);
    const open = projectKey !== null && projectKey === currentKey;

    useEffect(() => {
        if (projectKey !== currentKey) {
            closeAttentionQueue();
        }
    }, [projectKey, currentKey]);

    return (
        <Dialog.Root open={open} onOpenChange={(next) => !next && closeAttentionQueue()}>
            <Dialog.Popup
                initialFocus={initialFocus}
                className="flex max-h-[calc(100dvh-2rem)] w-[800px] max-w-[calc(100vw-2rem)] flex-col overflow-y-auto p-5"
            >
                <div className="flex items-center gap-3">
                    <Dialog.Title size="lg" className="grow">
                        {t('attention.title')}
                    </Dialog.Title>
                    <IconButton icon={X} label={t('common:action.close')} onClick={closeAttentionQueue} />
                </div>
                <Dialog.Description>{t('attention.project', { project: project?.name ?? '' })}</Dialog.Description>
                {open && <QueueBody initialFocus={initialFocus} />}
            </Dialog.Popup>
        </Dialog.Root>
    );
}
