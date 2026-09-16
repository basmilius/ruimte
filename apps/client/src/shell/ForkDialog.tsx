import { useState } from 'react';
import { Dialog } from '@base-ui-components/react/dialog';
import { GitFork } from 'lucide-react';
import { CHAT_FORK_TITLE_MAX } from '@ruimte/contracts';
import { forkOriginIn, forkPayload, forkPointLabel, forkPointOf, forkRefusal, forkShapes, type ForkShape } from '@/chat/logic/fork';
import { showViewWhenItLands } from '@/project/views';
import { canvasOfNode, revealWhenItLands } from '@/state/canvas';
import { useChatRow } from '@/state/chats';
import { useDocument } from '@/state/document';
import { useUi } from '@/state/ui';
import { useTransport } from '@/transport/context';
import { Button } from '@/ui/Button';
import { ErrorBoundary } from '@/ui/ErrorBoundary';
import { Icon } from '@/ui/Icon';
import { Select, type SelectItem } from '@/ui/Select';

const SHAPE_ITEMS: Record<ForkShape, SelectItem<ForkShape>> = {
    node: { value: 'node', label: 'A node beside it' },
    view: { value: 'view', label: 'A new view' }
};

/*
 * Forks a chat after one of its turns, with the history up to and including that turn: a chat view
 * forks into a view listed after it, a node into a node beside it or, when picked, a view. The turn
 * is where the person clicked, so the dialog only says which one it is.
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
    const origin = useDocument((s) => forkOriginIn(s.views, chatId)?.shape ?? 'node');
    const viewName = useDocument((s) => forkOriginIn(s.views, chatId)?.title);
    // A node's live editor names it before a save has brought the document up to date.
    const originalTitle = canvasOfNode(chatId)?.getState().nodes[chatId]?.title ?? viewName ?? 'Chat';
    const shapes = forkShapes(origin);
    const [title, setTitle] = useState(`${originalTitle} (fork)`.slice(0, CHAT_FORK_TITLE_MAX));
    const [shape, setShape] = useState<ForkShape>(shapes[0]!);
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState<string | null>(null);

    const point = items && order ? forkPointOf(items, order, turnId) : null;
    const refusal = forkRefusal(info, items?.[turnId]);
    const ready = refusal === null && point !== null && title.trim() !== '';

    const submit = async (): Promise<void> => {
        if (!ready || busy) {
            return;
        }
        setBusy(true);
        setFailure(null);
        try {
            const result = await transport.request('chat.fork', forkPayload({ chatId, turnId, title: title.trim(), shape }));
            if (shape === 'view') {
                showViewWhenItLands(result.viewId);
            } else {
                revealWhenItLands(result.viewId, result.nodeId);
            }
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
                {shape === 'view'
                    ? `A new chat view goes on from there with the same CLI, right after ${origin === 'view' ? 'the original' : 'its canvas'} in the sidebar. Nothing is sent until you write the first message.`
                    : 'A new chat node goes on from there with the same CLI, beside the original and with a line from it. Nothing is sent until you write the first message.'}
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
            {shapes.length > 1 && (
                <div className="mt-3 flex items-center justify-between gap-3">
                    <span className="text-xs text-text-muted">Fork into</span>
                    <Select<ForkShape>
                        label="Fork into"
                        variant="outlined"
                        value={shape}
                        onValueChange={setShape}
                        items={shapes.map((value) => SHAPE_ITEMS[value])}
                    />
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
