import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
    ChevronsDownUp,
    ChevronsUpDown,
    Copy,
    Expand,
    ExternalLink,
    Frame,
    GitBranch,
    GitMerge,
    Link2,
    Maximize2,
    MessageSquare,
    Palette,
    Pencil,
    Shrink,
    Sparkles,
    Terminal,
    Trash
} from 'lucide-react';
import type { ProviderInfo } from '@ruimte/contracts';
import { colorNoteAction, createNodeAction, duplicateNodeAction, focusNodeAction, linkNodesAction } from '@/actions/client-actions';
import { ChatAgentSubmenu } from '@/agents/AgentMenus';
import { FlagSubmenu } from '@/project/FlagSubmenu';
import { askOpenAsView, canOpenAsView } from '@/project/views';
import { accentLabel, NODE_ACCENTS } from '@/canvas/accents';
import { DEFAULT_NOTE_COLOR, NOTE_COLORS } from '@/canvas/note-colors';
import { EMPTY_DRAFT, writeDraft } from '@ruimte/agents-react/chat/drafts';
import { BookmarkSubmenu } from '@ruimte/agents-react/chat/ui/BookmarkSubmenu';
import { ForkMenuItem } from '@/chat/ForkMenuItem';
import { FileActionItems } from '@/shell/panels/FileActionItems';
import { resolveStoredPath } from '@/shell/panels/files-tree';
import { worktreeDiffTab } from '@/shell/panels/worktree-rows';
import { deleteSelectionAsking } from '@/canvas/delete-selection';
import { maximizedNodeOf, useCanvas, useCanvasStore } from '@/state/canvas';
import { useChatRow } from '@ruimte/agents-react/state/chats';
import { useFiles } from '@/state/files';
import { useProject } from '@/state/project';
import { useProviders } from '@ruimte/agents-react/state/providers';
import { fileManagerName, useServer } from '@/state/server';
import { useSessionRow } from '@/state/sessions';
import { useSettings } from '@/state/settings';
import { useUi } from '@/state/ui';
import { useGroupWorktrees, useWorktreeOf } from '@/state/worktrees';
import { useTransport } from '@/transport/context';
import { ColorSwatch, Icon, Tooltip, Kbd, ContextMenu } from '@basmilius/react-ui';
import { CANVAS_SHORTCUTS } from '@/canvas/shortcuts';

/*
 * The context menu of one node, the same from its frame and from its row in the sidebar. `snooze`
 * leads it, and is all a row offers for a node that is not on the canvas this menu acts on.
 */
export function NodeMenuPopup({ id, onRename, snooze }: { id: string; onRename(): void; snooze?: ReactNode }) {
    const { t } = useTranslation('canvas');
    const canvasStore = useCanvasStore();
    const node = useCanvas((s) => s.nodes[id]);
    const maximized = useCanvas((s) => maximizedNodeOf(s) === id);
    const agent = useSessionRow(id, (row) => row?.agent);
    const sessionAccount = useSessionRow(id, (row) => row?.account);
    const chatSession = useChatRow(id, (row) => row?.info.agentSessionId);
    const chatCwd = useChatRow(id, (row) => row?.info.cwd);
    const chatProvider = useChatRow(id, (row) => row?.info.provider);
    const chatAccount = useChatRow(id, (row) => row?.info.account);
    const platform = useServer((s) => s.platform);
    const providers = useProviders((s) => s.providers);
    const projectFolder = useProject((s) => s.current?.folder ?? null);
    const transport = useTransport();
    const nodeWorktree = useWorktreeOf(node?.kind === 'terminal' || node?.kind === 'chat' ? node.cwd : undefined);
    const groupWorktrees = useGroupWorktrees(node?.kind === 'group' ? id : null);

    if (!node) {
        return snooze ? <ContextMenu.Popup>{snooze}</ContextMenu.Popup> : null;
    }

    const remove = (): void => {
        canvasStore.getState().select([id]);
        void deleteSelectionAsking(canvasStore, transport);
    };
    if (node.kind === 'unknown') {
        return <UnknownNodeMenuPopup id={id} onDelete={remove} />;
    }
    // The same CLI session can continue in the other kind of node, next to this one.
    const beside = { x: node.x + node.w + 40 + 260, y: node.y + node.h / 2 };
    // Any CLI the daemon has a chat backend for can go on in a chat node.
    const canOpenInChat = agent ? providers.some((entry) => entry.kind === agent.kind && entry.capabilities.chat) : false;
    const viewId = canvasStore.getState().viewId;
    const openInChat = (): void => {
        if (agent) {
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
    const openInTerminal = (): void => {
        // The daemon owns the resume line: the node only says which CLI and which session.
        if (chatSession && chatProvider) {
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
    const startAgentFromNote = async (provider: ProviderInfo): Promise<void> => {
        const chatId = await createNodeAction('chat', { viewId, provider: provider.kind, at: beside });
        if (chatId === null || viewId === null) {
            return;
        }
        const body = node.body?.trim();
        if (body) {
            writeDraft(chatId, { ...EMPTY_DRAFT, text: body });
        }
        await linkNodesAction(viewId, id, chatId);
    };
    // The folder the node works in: its own, or the project's when it has none.
    const workingFolder = node.kind === 'terminal' || node.kind === 'chat' ? (node.cwd ?? chatCwd ?? projectFolder) : (node.worktree?.path ?? null);
    // What the node holds is stored against the project folder; the menu acts on the daemon's path.
    const filePath = node.kind === 'file' && node.path ? resolveStoredPath(projectFolder, node.path) : null;

    return (
        <ContextMenu.Popup>
            {snooze}
            <ContextMenu.Item onClick={onRename}>
                <Icon icon={Pencil} size={14} /> {t('common:action.rename')} <ContextMenu.Hint>{t('menu.doubleClick')}</ContextMenu.Hint>
            </ContextMenu.Item>
            <ContextMenu.Item onClick={() => duplicateNodeAction(canvasStore.getState().viewId, id)}>
                <Icon icon={Copy} size={14} /> {t('menu.duplicate')}
            </ContextMenu.Item>
            <ContextMenu.Item onClick={() => focusNodeAction(canvasStore.getState().viewId, id)}>
                <Icon icon={Maximize2} size={14} /> {t('node.zoomTo')}
            </ContextMenu.Item>
            {node.kind !== 'group' && (
                <ContextMenu.Item onClick={() => canvasStore.getState().toggleMaximizedNode(id)}>
                    <Icon icon={maximized ? Shrink : Expand} size={14} /> {t(maximized ? 'node.restore' : 'node.maximize')}{' '}
                    <Kbd shortcut={CANVAS_SHORTCUTS.maximizeCell} />
                </ContextMenu.Item>
            )}
            <ContextMenu.Item onClick={() => canvasStore.getState().startLink(id)}>
                <Icon icon={Link2} size={14} /> {t('menu.connect')}
                <ContextMenu.Hint>{t('menu.connectHint')}</ContextMenu.Hint>
            </ContextMenu.Item>
            {node.kind === 'group' && (
                <>
                    <ContextMenu.Item onClick={() => canvasStore.getState().toggleGroupCollapse(id)}>
                        {node.collapsed ? <Icon icon={ChevronsUpDown} size={14} /> : <Icon icon={ChevronsDownUp} size={14} />}{' '}
                        {node.collapsed ? t('group.expand') : t('group.collapse')}
                    </ContextMenu.Item>
                    {node.worktree ? (
                        <ContextMenu.Item onClick={() => canvasStore.getState().setGroupWorktree(id, null)}>
                            <Icon icon={GitBranch} size={14} /> {t('menu.unbindWorktree')}
                            <ContextMenu.Hint>{t('menu.unbindWorktreeHint')}</ContextMenu.Hint>
                        </ContextMenu.Item>
                    ) : (
                        <ContextMenu.Item onClick={() => useUi.getState().setWorktreeDialogFor(id)}>
                            <Icon icon={GitBranch} size={14} /> {t('menu.bindWorktree')}
                        </ContextMenu.Item>
                    )}
                    {groupWorktrees.length > 0 && projectFolder !== null && (
                        <>
                            <ContextMenu.Item
                                onClick={() =>
                                    useUi.getState().setWorktreeMerge({ folder: projectFolder, paths: groupWorktrees.map((worktree) => worktree.path) })
                                }
                            >
                                <Icon icon={GitMerge} size={14} /> {t('menu.mergeWorktrees', { count: groupWorktrees.length })}
                            </ContextMenu.Item>
                            <ContextMenu.Item
                                onClick={() =>
                                    useUi.getState().setWorktreeRemoval({ folder: projectFolder, paths: groupWorktrees.map((worktree) => worktree.path) })
                                }
                            >
                                <Icon icon={Trash} size={14} /> {t('menu.removeWorktrees', { count: groupWorktrees.length })}
                            </ContextMenu.Item>
                        </>
                    )}
                </>
            )}
            {nodeWorktree && projectFolder !== null && (
                <>
                    <ContextMenu.Separator />
                    <ContextMenu.Item
                        onClick={() => {
                            // Selecting the node is what points the git panel at the worktree it works in.
                            canvasStore.getState().select([id]);
                            useUi.getState().setPanel({ open: true, kind: 'git' });
                            const tab = worktreeDiffTab(nodeWorktree);
                            useFiles.getState().open(tab.path, useSettings.getState().filesTabLimit, tab.view);
                        }}
                    >
                        <Icon icon={GitBranch} size={14} /> {t('menu.viewWorktree')}
                        <ContextMenu.Hint className="font-mono">{nodeWorktree.branch}</ContextMenu.Hint>
                    </ContextMenu.Item>
                    <ContextMenu.Item onClick={() => useUi.getState().setWorktreeMerge({ folder: projectFolder, paths: [nodeWorktree.path] })}>
                        <Icon icon={GitMerge} size={14} /> {t('menu.mergeWorktrees', { count: 1 })}
                    </ContextMenu.Item>
                    <ContextMenu.Item onClick={() => useUi.getState().setWorktreeRemoval({ folder: projectFolder, paths: [nodeWorktree.path] })}>
                        <Icon icon={Trash} size={14} /> {t('menu.removeWorktrees', { count: 1 })}
                    </ContextMenu.Item>
                    <ContextMenu.Separator />
                </>
            )}
            {node.kind === 'terminal' && canOpenInChat && (
                <ContextMenu.Item onClick={openInChat}>
                    <Icon icon={MessageSquare} size={14} /> {t('menu.openInChat')}
                </ContextMenu.Item>
            )}
            {node.kind === 'chat' && chatSession && (
                <ContextMenu.Item onClick={openInTerminal}>
                    <Icon icon={Terminal} size={14} /> {t('menu.openInTerminal')}
                </ContextMenu.Item>
            )}
            {node.kind === 'chat' && <ForkMenuItem chatId={id} />}
            {node.kind === 'chat' && <BookmarkSubmenu chatId={id} />}
            {canOpenAsView(node.kind) && (
                <ContextMenu.Item onClick={() => askOpenAsView(id)}>
                    <Icon icon={Frame} size={14} /> {t('menu.openAsView')}
                    <ContextMenu.Hint>{t('menu.openAsViewHint')}</ContextMenu.Hint>
                </ContextMenu.Item>
            )}
            {workingFolder && (
                <ContextMenu.Item onClick={() => void transport.request('fs.reveal', { path: workingFolder }).catch(() => undefined)}>
                    <Icon icon={ExternalLink} size={14} /> {t('menu.reveal', { app: fileManagerName(platform) })}
                </ContextMenu.Item>
            )}
            {node.kind === 'file' && filePath !== null && (
                <>
                    <ContextMenu.Separator />
                    <FileActionItems path={filePath} on="node" />
                    <ContextMenu.Separator />
                </>
            )}
            {node.kind === 'note' && (
                <>
                    <ChatAgentSubmenu
                        label={t('menu.startAgentFromNote')}
                        icon={<Icon icon={Sparkles} size={14} />}
                        onPick={(provider) => void startAgentFromNote(provider)}
                    />
                    <ContextMenu.SubmenuRoot>
                        <ContextMenu.SubmenuTrigger>
                            <Icon icon={Palette} size={14} /> {t('menu.noteColor')}
                        </ContextMenu.SubmenuTrigger>
                        <ContextMenu.Popup className="min-w-40">
                            {NOTE_COLORS.map((color) => (
                                <ContextMenu.Item key={color.id} onClick={() => colorNoteAction(viewId, id, color.id)}>
                                    <ContextMenu.Check kind="radio" checked={(node.color ?? DEFAULT_NOTE_COLOR) === color.id} />
                                    <span className={`h-3 w-3 rounded-full border border-border-strong ${color.className}`} /> {t(`noteColors.${color.id}`)}
                                </ContextMenu.Item>
                            ))}
                        </ContextMenu.Popup>
                    </ContextMenu.SubmenuRoot>
                </>
            )}
            <FlagSubmenu id={id} />
            <ContextMenu.SubmenuRoot>
                <ContextMenu.SubmenuTrigger>
                    <Icon icon={Palette} size={14} /> {t('menu.color')}
                </ContextMenu.SubmenuTrigger>
                {/* Every hue at once, so the labels give way to a grid the eye
                    reads in one pass; the name of a color lives in its tooltip. */}
                <ContextMenu.Popup className="grid min-w-0 grid-cols-6 gap-1 p-2">
                    <Tooltip label={t('menu.noAccent')}>
                        <ColorSwatch
                            render={<ContextMenu.Item unstyled />}
                            aria-label={t('menu.noAccent')}
                            picked={!node.accent}
                            onClick={() => canvasStore.getState().setNodeAccent(id, null)}
                        />
                    </Tooltip>
                    {NODE_ACCENTS.map((accent) => (
                        <Tooltip key={accent.id} label={accentLabel(accent.id)}>
                            <ColorSwatch
                                render={<ContextMenu.Item unstyled />}
                                aria-label={accentLabel(accent.id)}
                                color={accent.color}
                                picked={node.accent === accent.id}
                                on="popup"
                                onClick={() => canvasStore.getState().setNodeAccent(id, accent.id)}
                            />
                        </Tooltip>
                    ))}
                </ContextMenu.Popup>
            </ContextMenu.SubmenuRoot>
            <ContextMenu.Separator />
            <ContextMenu.Item className="text-status-error" onClick={remove}>
                <Icon icon={Trash} size={14} /> {t('common:action.delete')} <Kbd shortcut={CANVAS_SHORTCUTS.deleteSelection} />
            </ContextMenu.Item>
        </ContextMenu.Popup>
    );
}

/* A node of a kind a newer Ruimte made: this version can find it and remove it, and nothing more. */
function UnknownNodeMenuPopup({ id, onDelete }: { id: string; onDelete(): void }) {
    const { t } = useTranslation('canvas');
    const canvasStore = useCanvasStore();
    return (
        <ContextMenu.Popup>
            <ContextMenu.Item onClick={() => focusNodeAction(canvasStore.getState().viewId, id)}>
                <Icon icon={Maximize2} size={14} /> {t('node.zoomTo')}
            </ContextMenu.Item>
            <ContextMenu.Separator />
            <ContextMenu.Item className="text-status-error" onClick={onDelete}>
                <Icon icon={Trash} size={14} /> {t('common:action.delete')} <Kbd shortcut={CANVAS_SHORTCUTS.deleteSelection} />
            </ContextMenu.Item>
        </ContextMenu.Popup>
    );
}
