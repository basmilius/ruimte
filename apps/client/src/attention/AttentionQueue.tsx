import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { ChatScopeContext } from '@adecore/agents-react';
import { useChats } from '@adecore/agents-react/state';
import { isHiddenChatView } from '@ruimte/contracts';
import { Button, Dialog, Icon, IconButton, Pill } from '@adecore/ui';
import { formatNumber, useFormatLocale } from '@adecore/ui/format';
import { Check, CircleAlert, X } from 'lucide-react';
import { bringPromptToFront } from '@/canvas/prompt-stack';
import { projectNodes, useProjectNodes, type ProjectNodeRef } from '@/project/view-nodes';
import { revealNode } from '@/project/views';
import { WaitingPrompt } from '@/shell/NeedsYouCard';
import type { SidebarNode } from '@/shell/sidebar-rows';
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

const WIDE_QUEUE = '(min-width: 768px)';

function subscribeQueueWidth(changed: () => void): () => void {
    const query = window.matchMedia(WIDE_QUEUE);
    query.addEventListener('change', changed);

    return () => query.removeEventListener('change', changed);
}

function QueueGroup({ label, count, children }: { label: string; count: number; children: ReactNode }) {
    return (
        <>
            <p className="flex justify-between gap-2 px-3 py-2 text-xs font-medium text-text-muted">
                <span>{label}</span>
                <span className="tabular-nums">{formatNumber(count)}</span>
            </p>
            {children}
        </>
    );
}

function QueueBody({
    projectName,
    initialFocus,
    fallbackFocus
}: {
    projectName: string;
    initialFocus: RefObject<HTMLButtonElement | null>;
    fallbackFocus: RefObject<HTMLButtonElement | null>;
}) {
    const { t } = useTranslation('shell');
    useFormatLocale();
    const endpointId = useEndpointId();
    const nodes = useProjectNodes();
    const sessions = useSessions((state) => state.byKey);
    const chats = useChats((state) => state.statusByKey);
    const unseen = useAttention((state) => state.unseen);
    const snoozes = useSnoozes((state) => state.byKey);
    const since = useWaitingSince((state) => state.byKey);
    const [selected, setSelected] = useState<string | null>(null);
    const [answered, setAnswered] = useState<string | null>(null);
    const views = useDocument((state) => state.views);
    const wide = useSyncExternalStore(
        subscribeQueueWidth,
        () => window.matchMedia(WIDE_QUEUE).matches,
        () => true
    );
    const rows = useRef(new Map<string, HTMLButtonElement>());
    const back = useRef<HTMLButtonElement | null>(null);
    const detail = useRef<HTMLDivElement | null>(null);
    const detailRequested = useRef(false);
    const restoreRow = useRef<string | null>(null);
    const previous = useRef<{ id: string | null; wide: boolean }>({ id: null, wide });

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

    useLayoutEffect(() => {
        const before = previous.current;
        const removed = before.id !== null && !rows.current.has(before.id);
        const layoutChanged = before.wide !== wide;
        const displaced = removed && (document.activeElement === document.body || detail.current?.contains(document.activeElement) === true);

        if (restoreRow.current !== null) {
            rows.current.get(restoreRow.current)?.focus();
            restoreRow.current = null;
        } else if (!wide && selected !== null && (detailRequested.current || layoutChanged || displaced)) {
            (active === null ? fallbackFocus.current : back.current)?.focus();
        } else if (displaced || (wide && layoutChanged && selected !== null)) {
            (active === null ? fallbackFocus.current : rows.current.get(active.id))?.focus();
        }

        detailRequested.current = false;
        previous.current = { id: active?.id ?? null, wide };
    }, [active, fallbackFocus, selected, wide]);

    const openSession = (): void => {
        if (active !== null && projectNodes().some((node) => node.id === active.id)) {
            closeAttentionQueue();
            revealNode(active.id);
            bringPromptToFront(active.id);
        }
    };

    const row = (node: ProjectNodeRef, waits: boolean) => {
        const failed = nodeStatus(node, sessions, chats, endpointId) === 'error';

        return (
            <Button
                key={node.id}
                ref={(element) => {
                    if (element === null) {
                        rows.current.delete(node.id);
                    } else {
                        rows.current.set(node.id, element);
                    }

                    if (active?.id === node.id) {
                        initialFocus.current = element;
                    }
                }}
                className={`h-auto w-full items-start justify-start gap-2 whitespace-normal px-3 py-2 text-left ${active?.id === node.id ? 'bg-surface-hover text-text' : ''}`}
                aria-pressed={active?.id === node.id}
                onClick={() => {
                    detailRequested.current = true;
                    setAnswered(null);
                    setSelected(node.id);
                }}
            >
                <span className="line-clamp-2 min-w-0 grow break-words">{node.title}</span>
                {waits ? (
                    <WaitLabel detail={details.get(node.id)} />
                ) : (
                    <Pill size="sm" tone={failed ? 'error' : 'muted'} icon={<Icon icon={failed ? CircleAlert : Check} size={12} />}>
                        <span className="sr-only">{t(failed ? 'attention.error' : 'attention.finished')}</span>
                    </Pill>
                )}
            </Button>
        );
    };

    if (entries.length === 0) {
        return (
            <>
                <Dialog.Description className="px-5">{t('attention.project', { project: projectName })}</Dialog.Description>
                <p className="px-5 pb-5 pt-6 text-sm text-text-muted">{t('attention.empty')}</p>
            </>
        );
    }

    return (
        <>
            <Dialog.Description className="px-5 pb-4">
                {t('attention.projectLeft', { project: projectName, count: formatNumber(entries.length) })}
            </Dialog.Description>
            <div className="grid min-h-0 grow border-t border-border md:h-[28rem] md:grid-cols-[18rem_minmax(0,1fr)]">
                <div className={`max-h-60 overflow-auto border-border p-2 md:max-h-none md:border-r ${selected === null ? '' : 'hidden md:block'}`}>
                    {asks.length > 0 && (
                        <QueueGroup label={t('attention.waiting')} count={asks.length}>
                            {asks.map((node) => row(node, true))}
                        </QueueGroup>
                    )}
                    {completed.length > 0 && (
                        <QueueGroup label={t('attention.finishedUnseen')} count={completed.length}>
                            {completed.map((node) => row(node, false))}
                        </QueueGroup>
                    )}
                    {answered !== null && (
                        <p role="status" className="px-3 py-2 text-xs text-text-muted">
                            {t('attention.answered', { title: answered })}
                        </p>
                    )}
                </div>
                <div ref={detail} className={`min-w-0 overflow-auto ${selected === null ? 'hidden md:block' : ''}`}>
                    <Button
                        ref={back}
                        className="m-2 md:hidden"
                        onClick={() => {
                            restoreRow.current = active?.id ?? null;
                            setSelected(null);
                        }}
                    >
                        {t('attention.backToList')}
                    </Button>
                    {preview && (
                        <ChatScopeContext.Provider value={chatScopeOf(machine)}>
                            <WaitingPrompt
                                key={endpointKey(machine, preview.id)}
                                endpointId={machine}
                                node={preview}
                                onOpen={hidden ? undefined : openSession}
                                onFocusEmpty={() => {
                                    (wide ? rows.current.get(preview.id) : back.current)?.focus();
                                }}
                                onSent={() => setAnswered(preview.title)}
                                summary
                                completed={!waiting.has(preview.id)}
                                preferredKind={details.get(preview.id)?.kind}
                            />
                        </ChatScopeContext.Provider>
                    )}
                </div>
            </div>
        </>
    );
}

export function AttentionQueue() {
    const { t } = useTranslation('shell');
    const projectKey = useAttentionQueue((state) => state.projectKey);
    const project = useProject((state) => state.current);
    const endpointId = useEndpointId();
    const initialFocus = useRef<HTMLButtonElement | null>(null);
    const closeButton = useRef<HTMLButtonElement | null>(null);
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
                className="flex max-h-[calc(100dvh-2rem)] w-[800px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden p-0"
            >
                <div className="flex items-center gap-3 px-5 pt-5">
                    <Dialog.Title size="lg" className="grow">
                        {t('attention.title')}
                    </Dialog.Title>
                    <IconButton ref={closeButton} icon={X} label={t('common:action.close')} onClick={closeAttentionQueue} />
                </div>
                {open && <QueueBody projectName={project?.name ?? ''} initialFocus={initialFocus} fallbackFocus={closeButton} />}
            </Dialog.Popup>
        </Dialog.Root>
    );
}
