import { useState } from 'react';
import { Dialog } from '@base-ui-components/react/dialog';
import { GitFork } from 'lucide-react';
import { CHAT_FORK_TITLE_MAX, isCanvasView } from '@ruimte/contracts';
import { forkPointLabel, forkPointOf, forkRefusal } from '@/chat/logic/fork';
import { canvasOfNode, revealWhenItLands } from '@/state/canvas';
import { useChatRow } from '@/state/chats';
import { useDocument } from '@/state/document';
import { useUi } from '@/state/ui';
import { useTransport } from '@/transport/context';
import { Button } from '@/ui/Button';
import { ErrorBoundary } from '@/ui/ErrorBoundary';
import { Icon } from '@/ui/Icon';
import { Select } from '@/ui/Select';

/*
 * Forks a chat after one of its turns into a chat node beside it, with the history up to and
 * including that turn. The turn is where the person clicked, so the dialog only says which one it is.
 */
export function ForkDialog() {
    const fork = useUi((s) => s.forkDialog);
    const close = (): void => useUi.getState().setForkDialog(null);
    return (
        <Dialog.Root
            open={fork !== null}
            onOpenChange={(open) => {
                if (!open) {
                    close();
                }
            }}
        >
            <Dialog.Portal>
                <Dialog.Backdrop className="dialog-backdrop" />
                <Dialog.Popup className="dialog-popup w-[440px] p-5">
                    <Dialog.Title className="flex items-center gap-2 text-base font-semibold text-text">
                        <Icon icon={GitFork} size={16} /> Fork this conversation
                    </Dialog.Title>
                    <ErrorBoundary label="The fork dialog failed to render" resetKeys={[fork?.chatId, fork?.turnId]}>
                        {fork !== null && <ForkForm key={`${fork.chatId}:${fork.turnId}`} chatId={fork.chatId} turnId={fork.turnId} onDone={close} />}
                    </ErrorBoundary>
                </Dialog.Popup>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

function ForkForm({ chatId, turnId, onDone }: { chatId: string; turnId: string; onDone(): void }) {
    const transport = useTransport();
    const info = useChatRow(chatId, (row) => row?.info ?? null);
    const items = useChatRow(chatId, (row) => row?.structure);
    const order = useChatRow(chatId, (row) => row?.order);
    const views = useDocument((s) => s.views);
    const chatView = views.find((view) => view.kind === 'chat' && view.id === chatId);
    const canvases = views.filter(isCanvasView);
    const originalTitle = chatView?.name ?? canvasOfNode(chatId)?.getState().nodes[chatId]?.title ?? 'Chat';
    const [title, setTitle] = useState(`${originalTitle} (fork)`.slice(0, CHAT_FORK_TITLE_MAX));
    const [canvasId, setCanvasId] = useState<string | null>(canvases[0]?.id ?? null);
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState<string | null>(null);

    const point = items && order ? forkPointOf(items, order, turnId) : null;
    const refusal = forkRefusal(info, items?.[turnId]);
    const needsCanvas = chatView !== undefined;
    const ready = refusal === null && point !== null && title.trim() !== '' && (!needsCanvas || canvasId !== null);

    const submit = async (): Promise<void> => {
        if (!ready || busy) {
            return;
        }
        setBusy(true);
        setFailure(null);
        try {
            const result = await transport.request('chat.fork', {
                chatId,
                turnId,
                title: title.trim(),
                ...(needsCanvas && canvasId !== null ? { viewId: canvasId } : {})
            });
            revealWhenItLands(result.viewId, result.nodeId);
            onDone();
        } catch (e) {
            setFailure(e instanceof Error ? e.message : 'The fork could not be made');
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            <p className="mt-1 text-sm text-text-muted">{point ? forkPointLabel(point) : 'This turn is no longer in the conversation.'}</p>
            <p className="mt-2 text-sm text-text-muted">
                A new chat node goes on from there with the same CLI, beside the original and with a line from it. Nothing is sent until you write the first
                message.
            </p>
            {point !== null && !point.last && (
                <p className="mt-2 text-sm text-text-muted">The files stay as they are now; the agent is told the folder is newer than this turn.</p>
            )}
            <label className="mt-3 block text-xs text-text-muted" htmlFor="fork-title">
                Title
            </label>
            <input
                id="fork-title"
                autoFocus
                className="field mt-1"
                value={title}
                maxLength={CHAT_FORK_TITLE_MAX}
                spellCheck={false}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') {
                        void submit();
                    }
                }}
            />
            {needsCanvas && (
                <div className="mt-3 flex items-center justify-between gap-3">
                    <span className="text-xs text-text-muted">Canvas</span>
                    {canvases.length === 0 ? (
                        <span className="text-sm text-text-muted">This project has no canvas to put the fork on.</span>
                    ) : (
                        <Select
                            label="Canvas"
                            variant="outlined"
                            value={canvasId}
                            onValueChange={setCanvasId}
                            items={canvases.map((canvas) => ({ value: canvas.id, label: canvas.name }))}
                        />
                    )}
                </div>
            )}
            {refusal !== null && <p className="mt-2 text-sm text-text-muted">{refusal}.</p>}
            {failure && <p className="mt-2 text-sm text-status-error">{failure}</p>}
            <div className="mt-4 flex items-center justify-end gap-2">
                <Button onClick={onDone}>Cancel</Button>
                <Button variant="primary" disabled={busy || !ready} onClick={() => void submit()}>
                    {busy ? 'Forking...' : 'Fork'}
                </Button>
            </div>
        </>
    );
}
