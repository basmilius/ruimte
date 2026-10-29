import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
    ChevronsDownUp,
    ChevronsUpDown,
    CircleStop,
    Copy,
    Crosshair,
    Eraser,
    EyeOff,
    Expand,
    ExternalLink,
    Frame,
    GitBranch,
    GitMerge,
    Group,
    LayoutGrid,
    Link2,
    MessageSquare,
    MessagesSquare,
    Move,
    Palette,
    Pencil,
    Plus,
    Scaling,
    Shrink,
    Sparkles,
    Terminal,
    Trash
} from 'lucide-react';
import { nodeColorOf, type NodeAccent, type ProviderInfo, type Task } from '@ruimte/contracts';
import {
    arrangeGroupAction,
    clearTerminalAction,
    colorNodeAction,
    createNodeAction,
    duplicateNodeAction,
    ignoreRefusal,
    linkNodesAction,
    perform
} from '@/actions/client-actions';
import { BringBackItem } from '@/canvas/BringBackItem';
import { ChatAgentSubmenu } from '@/agents/AgentMenus';
import { askBeforeClearingChat, askBeforeStoppingTask } from '@/agents/end-children';
import { FlagSubmenu } from '@/project/FlagSubmenu';
import { askOpenAsView, canOpenAsView, showView } from '@/project/views';
import { accentLabel, NODE_ACCENTS } from '@/canvas/accents';
import { EMPTY_DRAFT, writeDraft } from '@adecore/agents-react/chat';
import { BookmarkSubmenu } from '@adecore/agents-react/chat/ui';
import { ForkMenuItem } from '@/chat/ForkMenuItem';
import { useShownChatOfNode } from '@/chat/focused-chat';
import { useOffersFork } from '@/chat/use-offers-fork';
import { stopPrWatch } from '@/shell/pr-watch-actions';
import { useUnstartedTask } from '@/canvas/remote-wait';
import { useEndpointId } from '@/state/keys';
import { useChatPrWatch } from '@/state/pr-watches';
import { FileActionItems } from '@/shell/panels/FileActionItems';
import { resolveStoredPath } from '@/shell/panels/files-tree';
import { workFolderOf, worktreeDiffTab } from '@/shell/panels/worktree-rows';
import { deleteSelectionAsking } from '@/canvas/delete-selection';
import { setRunsHidden, useRunsHidden } from '@/routines/runs-hidden';
import { workflowCandidates, type WorkflowCandidate } from '@/chat/workflow/beside-workflows';
import { useWorkflowBesideSwitch } from '@/chat/workflow/workflow-beside-state';
import { canvasOfNode, maximizedNodeOf, useCanvas, useCanvasStore, type CanvasNode } from '@/state/canvas';
import { useViewNodes } from '@/project/view-nodes';
import { useChatRow, useProviders } from '@adecore/agents-react/state';
import { useFiles } from '@/state/files';
import { isScratchProject, useProject } from '@/state/project';
import { fileManagerName, useServer } from '@/state/server';
import { useSessionRow } from '@/state/sessions';
import { useSettings } from '@/state/settings';
import { useUi } from '@/state/ui';
import { useGroupWorktrees, useWorktreeOf } from '@/state/worktrees';
import { useToasts } from '@/state/toasts';
import { useWorkspace } from '@/transport/connections';
import { NodeMachineScope } from '@/transport/node-machine';
import { useTransport } from '@/transport/context';
import { DisabledReason, Icon, Kbd, ContextMenu } from '@adecore/ui';
import { CANVAS_SHORTCUTS } from '@/canvas/shortcuts';
import { formatNodeSize, makeDefaultSize } from '@/canvas/default-size';
import { CanvasCreateItems } from '@/canvas/CanvasMenu';
import type { Point } from '@/canvas/math';

interface NodeMenuProps {
    id: string;
    viewId?: string;
    onRename(): void;
    snooze?: ReactNode;
    /* False when a pick moved the keyboard somewhere the menu must not take it back from, such as a rename field. */
    finalFocus?: () => boolean;
    /* Where the right-click landed on a group on the canvas, so New node puts what it adds there and so in the group. */
    createAt?: () => Point;
}

/* A closed canvas is read from the document; only an action that needs its editor opens it. */
export function NodeMenuPopup(props: NodeMenuProps) {
    const live = useCanvas((s) => s.nodes[props.id]);
    const stored = useViewNodes((views, nodesOf) => {
        const view = views.find((view) => view.id === props.viewId);
        return view ? nodesOf(view).find((node) => node.id === props.id) : undefined;
    });
    const node = live ?? stored;
    return (
        <NodeMachineScope machine={node?.machine}>
            <NodeMenuContent {...props} node={node} />
        </NodeMachineScope>
    );
}

const NO_WORKFLOWS: readonly WorkflowCandidate[] = [];

function NodeMenuContent({ id, viewId: targetViewId, node, onRename, snooze, finalFocus, createAt }: NodeMenuProps & { node: CanvasNode | undefined }) {
    const { t } = useTranslation('canvas');
    const canvasStore = useCanvasStore();
    const endpointId = useEndpointId();
    // A design's conversation is the one of the chat it shows.
    const chatId = useShownChatOfNode(node) ?? id;
    const prWatch = useChatPrWatch(chatId);
    const waitingTask = useUnstartedTask(id, node?.machine);
    const maximized = useCanvas((s) => maximizedNodeOf(s) === id);
    const moveLocked = useCanvas((s) => s.locks.move);
    const canvasViewId = useCanvas((s) => s.viewId);
    const agent = useSessionRow(id, (row) => row?.agent);
    const sessionAccount = useSessionRow(id, (row) => row?.account);
    const chatSession = useChatRow(chatId, (row) => row?.info.agentSessionId);
    const offersFork = useOffersFork(chatId);
    const bookmarked = useChatRow(chatId, (row) => (row?.bookmarks?.length ?? 0) > 0);
    const chatCwd = useChatRow(chatId, (row) => row?.info.cwd);
    const chatProvider = useChatRow(chatId, (row) => row?.info.provider);
    const chatAccount = useChatRow(chatId, (row) => row?.info.account);
    const platform = useServer((s) => s.platform);
    const providers = useProviders((s) => s.providers);
    const projectFolder = useProject((s) => s.current?.folder ?? null);
    const scratch = useProject((s) => isScratchProject(s.current));
    // The machine of the node: the agents a clear would end are its.
    const transport = useTransport();
    // The project's worktrees, which a delete asks about, are the workspace's.
    const workspaceTransport = useWorkspace()?.connection.transport ?? transport;
    const nodeWorktree = useWorktreeOf(node === undefined ? undefined : workFolderOf(node, chatId));
    const groupWorktrees = useGroupWorktrees(node?.kind === 'group' ? id : null);
    const viewId = targetViewId ?? canvasViewId;
    const runsHidden = useRunsHidden(viewId, id);
    const workflows = useChatRow(id, (row) => (row === undefined ? NO_WORKFLOWS : workflowCandidates(row)));
    const workflowSwitch = useWorkflowBesideSwitch(
        endpointId,
        viewId,
        id,
        workflows.map((workflow) => workflow.id)
    );

    if (!node) {
        return snooze ? <ContextMenu.Popup>{snooze}</ContextMenu.Popup> : null;
    }

    const canvas = () => {
        if (viewId !== null) {
            showView(viewId);
        }
        return canvasOfNode(id) ?? canvasStore;
    };
    const zoomTo = (): void => canvas().getState().goToNode(id, { fit: true });
    const remove = (): void => {
        const store = canvas();
        store.getState().select([id]);
        void deleteSelectionAsking(store, workspaceTransport);
    };
    if (node.kind === 'unknown') {
        return <UnknownNodeMenuPopup onZoom={zoomTo} onDelete={remove} />;
    }
    const kind = node.kind;
    // The same CLI session can continue in the other kind of node, next to this one.
    const beside = { x: node.x + node.w + 40 + 260, y: node.y + node.h / 2 };
    // Any CLI the daemon has a chat backend for can go on in a chat node.
    const canOpenInChat = agent ? providers.some((entry) => entry.kind === agent.kind && entry.capabilities.chat) : false;
    const openInChat = (): void => {
        if (agent) {
            canvas();
            // The account travels with the session, since another account's folder does not hold its conversation.
            const account = agent.kind === node.provider ? (sessionAccount ?? node.account) : undefined;
            void createNodeAction('chat', {
                viewId,
                title: node.title,
                cwd: node.cwd,
                resume: agent.agentSessionId,
                provider: agent.kind,
                ...(account === undefined ? {} : { account }),
                at: beside
            });
        }
    };
    // The task was given by a chat of the workspace's machine, which owes the start and is the one that ends it.
    const stopWaiting = (task: Task): void => {
        void askBeforeStoppingTask(workspaceTransport, id, task.title, () => {
            void perform('chat.stopSubagent', { chatId: task.parentId, toolUseId: `task-${task.id}` }).catch(ignoreRefusal);
        });
    };
    const clearChat = (): void => {
        void askBeforeClearingChat(transport, chatId, node.title, () => {
            // The dialog already said that a running turn stops, so the composer's busy-turn question is skipped.
            perform('chat.clear', { chatId, force: true }).catch((error: unknown) =>
                useToasts.getState().show({
                    kind: 'error',
                    title: t('menu.clearFailed', { what: node.title }),
                    description: error instanceof Error ? error.message : undefined
                })
            );
        });
    };
    const openInTerminal = (): void => {
        // The daemon owns the resume line: the node only says which CLI and which session.
        if (chatSession && chatProvider) {
            canvas();
            void createNodeAction('terminal', {
                viewId,
                title: node.title,
                cwd: chatCwd,
                provider: chatProvider,
                resume: chatSession,
                ...(chatAccount === undefined ? {} : { account: chatAccount }),
                at: beside
            });
        }
    };
    /*
     * A note becomes the opening prompt of a chat beside it. The prompt is only seeded, never sent:
     * the person reads it once more and presses Enter. The edge keeps the note readable to the agent
     * through `ruimte-context`, so a note edited later still reaches it.
     */
    const startAgentFromNote = async (provider: ProviderInfo, account?: string): Promise<void> => {
        canvas();
        const chatId = await createNodeAction('chat', { viewId, provider: provider.kind, account, at: beside });
        if (chatId === null || viewId === null) {
            return;
        }
        const body = node.body?.trim();
        if (body) {
            writeDraft(chatId, { ...EMPTY_DRAFT, text: body });
        }
        await linkNodesAction(viewId, id, chatId);
    };
    // The folder the node works in: its own, or the project's when it has none. The Chats project shows none of its folders.
    const workingFolder = scratch
        ? null
        : node.kind === 'terminal' || node.kind === 'chat' || node.kind === 'design'
          ? (workFolderOf(node, chatId) ?? chatCwd ?? projectFolder)
          : (node.worktree?.path ?? null);
    // What the node holds is stored against the project folder; the menu acts on the daemon's path.
    const filePath = node.kind === 'file' && node.path ? resolveStoredPath(projectFolder, node.path) : null;

    // A collapsed group is only its header, which is no size to start a group at.
    const sizable = !(node.kind === 'group' && node.collapsed);
    const worktreeOf = nodeWorktree && projectFolder !== null ? nodeWorktree : null;
    const groupWorktreePaths = groupWorktrees.length > 0 && projectFolder !== null ? groupWorktrees.map((worktree) => worktree.path) : [];
    const place = canOpenAsView(node.kind) || workingFolder !== null || filePath !== null;
    // A chat that has not run a turn yet has nothing to put under Conversation.
    const isChat = node.kind === 'chat' || node.kind === 'design';
    const conversation = isChat && (offersFork || bookmarked || Boolean(chatSession) || prWatch !== null);

    return (
        <ContextMenu.Popup {...(finalFocus === undefined ? {} : { finalFocus })}>
            {snooze}
            {/* A collapsed group is only its header, with no room to put a node in. */}
            {createAt && node.kind === 'group' && !node.collapsed && (
                <>
                    <ContextMenu.SubmenuRoot>
                        <ContextMenu.SubmenuTrigger>
                            <Icon icon={Plus} size={14} /> {t('canvasMenu.newNode')}
                        </ContextMenu.SubmenuTrigger>
                        <ContextMenu.Popup>
                            <CanvasCreateItems at={createAt} />
                        </ContextMenu.Popup>
                    </ContextMenu.SubmenuRoot>
                    <ContextMenu.Separator />
                </>
            )}
            <ContextMenu.Item onClick={onRename}>
                <Icon icon={Pencil} size={14} /> {t('common:action.rename')} <ContextMenu.Hint>{t('menu.doubleClick')}</ContextMenu.Hint>
            </ContextMenu.Item>
            {node.kind !== 'design' && (
                <ContextMenu.Item onClick={() => duplicateNodeAction(canvas().getState().viewId, id)}>
                    <Icon icon={Copy} size={14} /> {t('menu.duplicate')}
                </ContextMenu.Item>
            )}
            <ContextMenu.Item onClick={() => canvas().getState().startLink(id)}>
                <Icon icon={Link2} size={14} /> {t('menu.connect')}
                <ContextMenu.Hint>{t('menu.connectHint')}</ContextMenu.Hint>
            </ContextMenu.Item>
            <ContextMenu.Separator />
            {conversation && (
                <ContextMenu.SubmenuRoot>
                    <ContextMenu.SubmenuTrigger>
                        <Icon icon={MessagesSquare} size={14} /> {t('menu.conversation')}
                    </ContextMenu.SubmenuTrigger>
                    <ContextMenu.Popup>
                        <ForkMenuItem chatId={chatId} />
                        <BookmarkSubmenu chatId={chatId} />
                        {chatSession && (
                            <ContextMenu.Item onClick={openInTerminal}>
                                <Icon icon={Terminal} size={14} /> {t('menu.openInTerminal')}
                            </ContextMenu.Item>
                        )}
                        {prWatch !== null && (
                            <ContextMenu.Item onClick={() => void stopPrWatch(endpointId, chatId)}>
                                <Icon icon={EyeOff} size={14} /> {t('menu.stopPrWatch')}
                            </ContextMenu.Item>
                        )}
                    </ContextMenu.Popup>
                </ContextMenu.SubmenuRoot>
            )}
            {node.kind === 'terminal' && (
                <ContextMenu.SubmenuRoot>
                    <ContextMenu.SubmenuTrigger>
                        <Icon icon={Terminal} size={14} /> {t('kinds.terminal')}
                    </ContextMenu.SubmenuTrigger>
                    <ContextMenu.Popup>
                        {canOpenInChat && (
                            <ContextMenu.Item onClick={openInChat}>
                                <Icon icon={MessageSquare} size={14} /> {t('menu.openInChat')}
                            </ContextMenu.Item>
                        )}
                        <ContextMenu.Item onClick={() => clearTerminalAction(id)}>
                            <Icon icon={Eraser} size={14} /> {t('menu.clear')}
                        </ContextMenu.Item>
                    </ContextMenu.Popup>
                </ContextMenu.SubmenuRoot>
            )}
            {node.kind === 'group' && (
                <ContextMenu.SubmenuRoot>
                    <ContextMenu.SubmenuTrigger>
                        <Icon icon={Group} size={14} /> {t('kinds.group')}
                    </ContextMenu.SubmenuTrigger>
                    <ContextMenu.Popup>
                        <ContextMenu.Item onClick={() => canvas().getState().toggleCollapse(id)}>
                            {node.collapsed ? <Icon icon={ChevronsUpDown} size={14} /> : <Icon icon={ChevronsDownUp} size={14} />}{' '}
                            {node.collapsed ? t('group.expand') : t('group.collapse')}
                        </ContextMenu.Item>
                        <DisabledReason reason={node.collapsed ? t('group.arrangeCollapsed') : moveLocked ? t('group.arrangeLocked') : null}>
                            <ContextMenu.Item disabled={node.collapsed || moveLocked} onClick={() => arrangeGroupAction(canvas().getState().viewId, id)}>
                                <Icon icon={LayoutGrid} size={14} /> {t('group.arrange')}
                            </ContextMenu.Item>
                        </DisabledReason>
                        {node.worktree ? (
                            <ContextMenu.Item onClick={() => canvas().getState().setGroupWorktree(id, null)}>
                                <Icon icon={GitBranch} size={14} /> {t('menu.unbindWorktree')}
                                <ContextMenu.Hint>{t('menu.unbindWorktreeHint')}</ContextMenu.Hint>
                            </ContextMenu.Item>
                        ) : (
                            <ContextMenu.Item
                                onClick={() => {
                                    canvas();
                                    useUi.getState().setWorktreeDialogFor(id);
                                }}
                            >
                                <Icon icon={GitBranch} size={14} /> {t('menu.bindWorktree')}
                            </ContextMenu.Item>
                        )}
                    </ContextMenu.Popup>
                </ContextMenu.SubmenuRoot>
            )}
            {(worktreeOf !== null || groupWorktreePaths.length > 0) && projectFolder !== null && (
                <ContextMenu.SubmenuRoot>
                    <ContextMenu.SubmenuTrigger>
                        <Icon icon={GitBranch} size={14} /> {t('menu.worktree')}
                    </ContextMenu.SubmenuTrigger>
                    <ContextMenu.Popup>
                        {worktreeOf !== null && (
                            <ContextMenu.Item
                                onClick={() => {
                                    // Selecting the node is what points the git panel at the worktree it works in.
                                    canvas().getState().select([id]);
                                    useUi.getState().setPanel({ open: true, kind: 'git' });
                                    const tab = worktreeDiffTab(worktreeOf);
                                    useFiles.getState().open(tab.path, useSettings.getState().filesTabLimit, tab.view);
                                }}
                            >
                                <Icon icon={GitBranch} size={14} /> {t('menu.viewWorktree')}
                                <ContextMenu.Hint className="font-mono">{worktreeOf.branch}</ContextMenu.Hint>
                            </ContextMenu.Item>
                        )}
                        <WorktreeItems folder={projectFolder} paths={worktreeOf !== null ? [worktreeOf.path] : groupWorktreePaths} />
                    </ContextMenu.Popup>
                </ContextMenu.SubmenuRoot>
            )}
            <ContextMenu.SubmenuRoot>
                <ContextMenu.SubmenuTrigger>
                    <Icon icon={Move} size={14} /> {t('menu.sizeAndPosition')}
                </ContextMenu.SubmenuTrigger>
                <ContextMenu.Popup>
                    <ContextMenu.Item onClick={zoomTo}>
                        <Icon icon={Crosshair} size={14} /> {t('node.zoomTo')}
                    </ContextMenu.Item>
                    {node.kind !== 'group' && (
                        <ContextMenu.Item onClick={() => canvas().getState().toggleMaximizedNode(id)}>
                            <Icon icon={maximized ? Shrink : Expand} size={14} /> {t(maximized ? 'node.restore' : 'node.maximize')}{' '}
                            <Kbd shortcut={CANVAS_SHORTCUTS.maximizeCell} />
                        </ContextMenu.Item>
                    )}
                    {sizable && (
                        <ContextMenu.Item onClick={() => void makeDefaultSize(endpointId, kind, { w: node.w, h: node.h })}>
                            <Icon icon={Scaling} size={14} /> {t('menu.makeDefaultSize')}
                            <ContextMenu.Hint>{formatNodeSize(node)}</ContextMenu.Hint>
                        </ContextMenu.Item>
                    )}
                </ContextMenu.Popup>
            </ContextMenu.SubmenuRoot>
            {(node.kind === 'terminal' || node.kind === 'chat') && <BringBackItem node={node} />}
            {waitingTask !== null && (
                <ContextMenu.Item onClick={() => stopWaiting(waitingTask)}>
                    <Icon icon={CircleStop} size={14} /> {t('menu.stopWaiting')}
                </ContextMenu.Item>
            )}
            {node.kind === 'note' && (
                <ChatAgentSubmenu
                    label={t('menu.startAgentFromNote')}
                    icon={<Icon icon={Sparkles} size={14} />}
                    onPick={(provider, account) => void startAgentFromNote(provider, account)}
                />
            )}
            {node.kind === 'routine' && viewId !== null && (
                <ContextMenu.Item onClick={() => setRunsHidden(viewId, id, !runsHidden)}>
                    <ContextMenu.Check kind="checkbox" checked={!runsHidden} /> {t('menu.showRuns')}
                </ContextMenu.Item>
            )}
            {node.kind === 'chat' && workflowSwitch !== null && (
                <ContextMenu.Item onClick={workflowSwitch.toggle}>
                    <ContextMenu.Check kind="checkbox" checked={workflowSwitch.shown} /> {t('menu.showWorkflow')}
                </ContextMenu.Item>
            )}
            <ContextMenu.Separator />
            <AccentSubmenu picked={nodeColorOf(node) ?? undefined} onPick={(accent) => colorNodeAction(canvas().getState().viewId, id, accent)} />
            <FlagSubmenu id={id} />
            {place && <ContextMenu.Separator />}
            {canOpenAsView(node.kind) && (
                <ContextMenu.Item
                    onClick={() => {
                        canvas();
                        askOpenAsView(id);
                    }}
                >
                    <Icon icon={Frame} size={14} /> {t('menu.openAsView')}
                    <ContextMenu.Hint>{t('menu.openAsViewHint')}</ContextMenu.Hint>
                </ContextMenu.Item>
            )}
            {workingFolder && (
                <ContextMenu.Item onClick={() => void transport.request('fs.reveal', { path: workingFolder }).catch(() => undefined)}>
                    <Icon icon={ExternalLink} size={14} /> {t('menu.openIn', { app: fileManagerName(platform) })}
                </ContextMenu.Item>
            )}
            {node.kind === 'file' && filePath !== null && <FileActionItems path={filePath} on="node" />}
            <ContextMenu.Separator />
            {isChat && (
                <ContextMenu.Item onClick={clearChat}>
                    <Icon icon={Eraser} size={14} /> {t('menu.clearAsking')}
                </ContextMenu.Item>
            )}
            <ContextMenu.Item className="text-status-error" onClick={remove}>
                <Icon icon={Trash} size={14} /> {t('common:action.delete')} <Kbd shortcut={CANVAS_SHORTCUTS.deleteSelection} />
            </ContextMenu.Item>
        </ContextMenu.Popup>
    );
}

function WorktreeItems({ folder, paths }: { folder: string; paths: string[] }) {
    const { t } = useTranslation('canvas');
    return (
        <>
            <ContextMenu.Item onClick={() => useUi.getState().setWorktreeMerge({ folder, paths })}>
                <Icon icon={GitMerge} size={14} /> {t('menu.mergeWorktrees', { count: paths.length })}
            </ContextMenu.Item>
            <ContextMenu.Item className="text-status-error" onClick={() => useUi.getState().setWorktreeRemoval({ folder, paths })}>
                <Icon icon={Trash} size={14} /> {t('menu.removeWorktrees', { count: paths.length })}
            </ContextMenu.Item>
        </>
    );
}

function AccentSubmenu({ picked, onPick }: { picked: string | undefined; onPick(accent: NodeAccent | null): void }) {
    const { t } = useTranslation('canvas');
    return (
        <ContextMenu.SubmenuRoot>
            <ContextMenu.SubmenuTrigger>
                <Icon icon={Palette} size={14} /> {t('menu.color')}
            </ContextMenu.SubmenuTrigger>
            {/* The same list as Flag; only the colors scroll, so None stays in sight in a short window. */}
            <ContextMenu.Popup className="flex min-w-44 flex-col overflow-hidden">
                <div className="min-h-0 overflow-y-auto overscroll-contain">
                    {NODE_ACCENTS.map((accent) => (
                        <ContextMenu.Item key={accent.id} onClick={() => onPick(accent.id)}>
                            <ContextMenu.Check kind="radio" checked={picked === accent.id} />
                            <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: accent.color }} aria-hidden />
                            <span className="grow">{accentLabel(accent.id)}</span>
                        </ContextMenu.Item>
                    ))}
                </div>
                <ContextMenu.Separator />
                <ContextMenu.Item onClick={() => onPick(null)}>
                    <ContextMenu.Check kind="radio" checked={!picked} /> {t('menu.noAccent')}
                </ContextMenu.Item>
            </ContextMenu.Popup>
        </ContextMenu.SubmenuRoot>
    );
}

/* A node of a kind a newer Ruimte made: this version can find it and remove it, and nothing more. */
function UnknownNodeMenuPopup({ onZoom, onDelete }: { onZoom(): void; onDelete(): void }) {
    const { t } = useTranslation('canvas');
    return (
        <ContextMenu.Popup>
            <ContextMenu.Item onClick={onZoom}>
                <Icon icon={Crosshair} size={14} /> {t('node.zoomTo')}
            </ContextMenu.Item>
            <ContextMenu.Separator />
            <ContextMenu.Item className="text-status-error" onClick={onDelete}>
                <Icon icon={Trash} size={14} /> {t('common:action.delete')} <Kbd shortcut={CANVAS_SHORTCUTS.deleteSelection} />
            </ContextMenu.Item>
        </ContextMenu.Popup>
    );
}
