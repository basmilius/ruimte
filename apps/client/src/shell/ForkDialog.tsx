import { useEffect, useState } from 'react';
import { Dialog } from '@base-ui-components/react/dialog';
import { GitFork } from 'lucide-react';
import { CHAT_FORK_TITLE_MAX, type ChatForkInfoResult } from '@ruimte/contracts';
import {
    branchRefusal,
    FORKABLE_PROVIDERS,
    forkOriginIn,
    forkPayload,
    forkPointLabel,
    forkPointOf,
    forkRefusal,
    forkShapes,
    type ForkCliChoice,
    type ForkShape
} from '@/chat/logic/fork';
import { readChatPreferences, selectionFor } from '@/chat/preferences';
import { ModelPicker } from '@/chat/ui/Pickers';
import { useProviders } from '@/state/providers';
import { Toggle } from '@/shell/settings/controls';
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
    // Null while the machine is asked; a machine that cannot say offers no worktree.
    const [folder, setFolder] = useState<ChatForkInfoResult | null>(null);
    const [inWorktree, setInWorktree] = useState(true);
    const [branch, setBranch] = useState<string | null>(null);
    const [filesAfterTurn, setFilesAfterTurn] = useState(true);
    const [cli, setCli] = useState<ForkCliChoice | null>(null);
    const [pickerOpen, setPickerOpen] = useState(false);
    const providers = useProviders((s) => s.providers);

    useEffect(() => {
        let current = true;
        transport
            .request('chat.forkInfo', { chatId, turnId })
            .catch(() => ({ repository: false, branches: [], branch: null, filesAfterTurn: false }))
            .then((answer) => {
                if (current) {
                    setFolder(answer);
                }
            });
        return () => {
            current = false;
        };
    }, [transport, chatId, turnId]);

    const point = items && order ? forkPointOf(items, order, turnId) : null;
    const refusal = forkRefusal(info, items?.[turnId]);
    const worktree = folder?.repository === true && inWorktree;
    const branchName = branch ?? folder?.branch ?? '';
    const branchProblem = worktree ? branchRefusal(branchName, folder.branches) : null;
    const originalCli: ForkCliChoice | null = info === null ? null : { provider: info.provider, selection: info.selection };
    const chosenCli = cli ?? originalCli;
    const pickable = providers.filter((entry) => FORKABLE_PROVIDERS.has(entry.kind) && entry.installed && entry.capabilities.chat);
    const switching = chosenCli !== null && originalCli !== null && chosenCli.provider !== originalCli.provider;
    const chooseCli = (provider: ForkCliChoice['provider'], model: string): void => {
        const remembered = provider === info?.provider ? info.selection : selectionFor(readChatPreferences(), provider);
        setCli({ provider, selection: remembered?.model === model ? remembered : { model, options: {} } });
    };
    const ready = refusal === null && point !== null && title.trim() !== '' && folder !== null && branchProblem === null;

    const submit = async (): Promise<void> => {
        if (!ready || busy) {
            return;
        }
        setBusy(true);
        setFailure(null);
        try {
            const result = await transport.request(
                'chat.fork',
                forkPayload({
                    chatId,
                    turnId,
                    title: title.trim(),
                    shape,
                    worktree: worktree ? { branch: branchName.trim(), filesAfterTurn: filesAfterTurn && folder.filesAfterTurn } : null,
                    ...(originalCli && chosenCli ? { cli: { original: originalCli, chosen: chosenCli } } : {})
                })
            );
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
                    ? `A new chat view goes on from there, right after ${origin === 'view' ? 'the original' : 'its canvas'} in the sidebar. Nothing is sent until you write the first message.`
                    : 'A new chat node goes on from there, beside the original and with a line from it. Nothing is sent until you write the first message.'}
            </p>
            {chosenCli !== null && pickable.length > 0 && (
                <>
                    <div className="mt-3 flex items-center justify-between gap-3">
                        <span className="text-xs text-text-muted">Continue with</span>
                        <ModelPicker
                            providers={pickable}
                            provider={chosenCli.provider}
                            selection={chosenCli.selection}
                            open={pickerOpen}
                            onOpenChange={setPickerOpen}
                            onChange={chooseCli}
                        />
                    </div>
                    {switching && (
                        <p className="mt-1 text-xs text-text-muted">
                            The new agent gets the last part of the conversation as text and can read the rest of the original itself.
                        </p>
                    )}
                </>
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
            <ForkFolder
                folder={folder}
                last={point?.last ?? true}
                inWorktree={inWorktree}
                onInWorktree={setInWorktree}
                branch={branchName}
                onBranch={setBranch}
                branchProblem={branchProblem}
                filesAfterTurn={filesAfterTurn}
                onFilesAfterTurn={setFilesAfterTurn}
                onSubmit={() => void submit()}
            />
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

interface ForkFolderProps {
    folder: ChatForkInfoResult | null;
    last: boolean;
    inWorktree: boolean;
    onInWorktree(inWorktree: boolean): void;
    branch: string;
    onBranch(branch: string): void;
    branchProblem: string | null;
    filesAfterTurn: boolean;
    onFilesAfterTurn(filesAfterTurn: boolean): void;
    onSubmit(): void;
}

/*
 * Where the fork works: a worktree of its own (the default in a repository) whose files can start
 * from where the turn left them, or the original's folder, where nothing is put back.
 */
function ForkFolder({ folder, last, inWorktree, onInWorktree, branch, onBranch, branchProblem, filesAfterTurn, onFilesAfterTurn, onSubmit }: ForkFolderProps) {
    if (folder === null) {
        return <p className="mt-3 text-sm text-text-muted">Looking at the folder...</p>;
    }
    const sharedNote = last ? null : 'The files stay as they are now; the agent is told the folder is newer than this turn.';
    if (!folder.repository) {
        return (
            <p className="mt-3 text-sm text-text-muted">
                This folder is not in a git repository; the fork works in the same folder.{sharedNote === null ? '' : ` ${sharedNote}`}
            </p>
        );
    }
    return (
        <>
            <div className="mt-3 flex items-center justify-between gap-3">
                <span className="text-sm text-text">Work in a git worktree</span>
                <Toggle label="Work in a git worktree" checked={inWorktree} onChange={onInWorktree} />
            </div>
            {inWorktree ? (
                <>
                    <label className="mt-2 block text-xs text-text-muted" htmlFor="fork-branch">
                        Branch
                    </label>
                    <input
                        id="fork-branch"
                        className="field mt-1 font-mono text-code"
                        value={branch}
                        spellCheck={false}
                        onChange={(e) => onBranch(e.target.value)}
                        onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === 'Enter') {
                                onSubmit();
                            }
                        }}
                    />
                    {branchProblem !== null && <p className="mt-1 text-xs text-status-error">{branchProblem}</p>}
                    <div className="mt-3 flex items-center justify-between gap-3">
                        <span className="text-sm text-text">{last ? 'Take the uncommitted files along' : 'Undo the work after this turn'}</span>
                        <Toggle
                            label={last ? 'Take the uncommitted files along' : 'Undo the work after this turn'}
                            checked={filesAfterTurn && folder.filesAfterTurn}
                            disabled={!folder.filesAfterTurn}
                            onChange={onFilesAfterTurn}
                        />
                    </div>
                    <p className="mt-1 text-xs text-text-muted">
                        {!folder.filesAfterTurn
                            ? 'The files of this turn are no longer in the repository, so the worktree starts from HEAD.'
                            : filesAfterTurn
                              ? 'The worktree starts from the files as they were after this turn; the original keeps its own.'
                              : 'The worktree starts from HEAD, without uncommitted work.'}
                    </p>
                </>
            ) : (
                sharedNote !== null && <p className="mt-2 text-sm text-text-muted">{sharedNote}</p>
            )}
        </>
    );
}
