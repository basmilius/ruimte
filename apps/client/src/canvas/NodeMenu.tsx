import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { ContextMenu } from '@base-ui-components/react/context-menu';
import {
    Check,
    ChevronRight,
    ChevronsDownUp,
    ChevronsUpDown,
    Copy,
    ExternalLink,
    Frame,
    GitBranch,
    GitMerge,
    Link2,
    Maximize2,
    MessageSquare,
    Palette,
    Pencil,
    Sparkles,
    Terminal,
    Trash
} from 'lucide-react';
import type { ProviderInfo } from '@ruimte/contracts';
import { ChatAgentSubmenu } from '@/agents/AgentMenus';
import { addAgentNode } from '@/agents/nodes';
import { askOpenAsView, canOpenAsView } from '@/project/views';
import { accentLabel, NODE_ACCENTS } from '@/canvas/accents';
import { DEFAULT_NOTE_COLOR, NOTE_COLORS } from '@/canvas/note-colors';
import { EMPTY_DRAFT, writeDraft } from '@/chat/drafts';
import { ForkMenuItem } from '@/chat/ui/ForkMenuItem';
import { FileActionItems } from '@/shell/panels/FileActionItems';
import { resolveStoredPath } from '@/shell/panels/files-tree';
import { worktreeDiffTab } from '@/shell/panels/worktree-rows';
import { deleteSelectionAsking } from '@/canvas/delete-selection';
import { useCanvas, useCanvasStore } from '@/state/canvas';
import { useChatRow } from '@/state/chats';
import { useFiles } from '@/state/files';
import { useProject } from '@/state/project';
import { useProviders } from '@/state/providers';
import { fileManagerName, useServer } from '@/state/server';
import { useSessionRow } from '@/state/sessions';
import { useSettings } from '@/state/settings';
import { useUi } from '@/state/ui';
import { useGroupWorktrees, useWorktreeOf } from '@/state/worktrees';
import { useTransport } from '@/transport/context';
import { ACCENT_SWATCH, ACCENT_SWATCH_PICKED, MENU_HINT, MENU_SEPARATOR } from '@/ui/classes';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';
import { CANVAS_SHORTCUTS } from '@/canvas/shortcuts';
import { Kbd } from '@/ui/Kbd';

/* The context menu of one node, the same from its frame and from its row in the sidebar. */
export function NodeMenuPopup({ id, onRename }: { id: string; onRename(): void }) {
    const { t } = useTranslation('canvas');
    const canvasStore = useCanvasStore();
    const node = useCanvas((s) => s.nodes[id]);
    const agent = useSessionRow(id, (row) => row?.agent);
    const chatSession = useChatRow(id, (row) => row?.info.agentSessionId);
    const chatCwd = useChatRow(id, (row) => row?.info.cwd);
    const chatProvider = useChatRow(id, (row) => row?.info.provider);
    const platform = useServer((s) => s.platform);
    const providers = useProviders((s) => s.providers);
    const projectFolder = useProject((s) => s.current?.folder ?? null);
    const transport = useTransport();
    const nodeWorktree = useWorktreeOf(node?.kind === 'terminal' || node?.kind === 'chat' ? node.cwd : undefined);
    const groupWorktrees = useGroupWorktrees(node?.kind === 'group' ? id : null);

    if (!node) {
        return null;
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
    const openInChat = (): void => {
        if (agent) {
            canvasStore
                .getState()
                .addNode('chat', beside, { title: node.title, cwd: node.cwd, resume: agent.agentSessionId, provider: agent.kind, providerFixed: true });
        }
    };
    const openInTerminal = (): void => {
        // The daemon owns the resume line: the node only says which CLI and which session.
        if (chatSession && chatProvider) {
            canvasStore.getState().addNode('terminal', beside, { title: node.title, cwd: chatCwd, provider: chatProvider, resume: chatSession });
        }
    };
    /*
     * A note becomes the opening prompt of a chat beside it. The prompt is only seeded, never sent:
     * the person reads it once more and presses Enter. The edge keeps the note readable to the agent
     * through `ruimte-context`, so a note edited later still reaches it.
     */
    const startAgentFromNote = (provider: ProviderInfo): void => {
        const chatId = addAgentNode('chat', provider, beside);
        if (chatId === null) {
            return;
        }
        const body = node.body?.trim();
        if (body) {
            writeDraft(chatId, { ...EMPTY_DRAFT, text: body });
        }
        canvasStore.getState().addEdge(id, chatId);
    };
    // The folder the node works in: its own, or the project's when it has none.
    const workingFolder = node.kind === 'terminal' || node.kind === 'chat' ? (node.cwd ?? chatCwd ?? projectFolder) : (node.worktree?.path ?? null);
    // What the node holds is stored against the project folder; the menu acts on the daemon's path.
    const filePath = node.kind === 'file' && node.path ? resolveStoredPath(projectFolder, node.path) : null;

    return (
        <ContextMenu.Portal>
            <ContextMenu.Positioner className="z-(--z-popup)">
                <ContextMenu.Popup className="menu-popup">
                    <ContextMenu.Item className="menu-item" onClick={onRename}>
                        <Icon icon={Pencil} size={14} /> {t('common:action.rename')} <span className={MENU_HINT}>{t('menu.doubleClick')}</span>
                    </ContextMenu.Item>
                    <ContextMenu.Item className="menu-item" onClick={() => canvasStore.getState().duplicateNode(id)}>
                        <Icon icon={Copy} size={14} /> {t('menu.duplicate')}
                    </ContextMenu.Item>
                    <ContextMenu.Item className="menu-item" onClick={() => canvasStore.getState().goToNode(id)}>
                        <Icon icon={Maximize2} size={14} /> {t('node.zoomTo')}
                    </ContextMenu.Item>
                    <ContextMenu.Item className="menu-item" onClick={() => canvasStore.getState().startLink(id)}>
                        <Icon icon={Link2} size={14} /> {t('menu.connect')}
                        <span className={MENU_HINT}>{t('menu.connectHint')}</span>
                    </ContextMenu.Item>
                    {node.kind === 'group' && (
                        <>
                            <ContextMenu.Item className="menu-item" onClick={() => canvasStore.getState().toggleGroupCollapse(id)}>
                                {node.collapsed ? <Icon icon={ChevronsUpDown} size={14} /> : <Icon icon={ChevronsDownUp} size={14} />}{' '}
                                {node.collapsed ? t('group.expand') : t('group.collapse')}
                            </ContextMenu.Item>
                            {node.worktree ? (
                                <ContextMenu.Item className="menu-item" onClick={() => canvasStore.getState().setGroupWorktree(id, null)}>
                                    <Icon icon={GitBranch} size={14} /> {t('menu.unbindWorktree')}
                                    <span className={MENU_HINT}>{t('menu.unbindWorktreeHint')}</span>
                                </ContextMenu.Item>
                            ) : (
                                <ContextMenu.Item className="menu-item" onClick={() => useUi.getState().setWorktreeDialogFor(id)}>
                                    <Icon icon={GitBranch} size={14} /> {t('menu.bindWorktree')}
                                </ContextMenu.Item>
                            )}
                            {groupWorktrees.length > 0 && projectFolder !== null && (
                                <>
                                    <ContextMenu.Item
                                        className="menu-item"
                                        onClick={() =>
                                            useUi.getState().setWorktreeMerge({ folder: projectFolder, paths: groupWorktrees.map((worktree) => worktree.path) })
                                        }
                                    >
                                        <Icon icon={GitMerge} size={14} /> {t('menu.mergeWorktrees', { count: groupWorktrees.length })}
                                    </ContextMenu.Item>
                                    <ContextMenu.Item
                                        className="menu-item"
                                        onClick={() =>
                                            useUi
                                                .getState()
                                                .setWorktreeRemoval({ folder: projectFolder, paths: groupWorktrees.map((worktree) => worktree.path) })
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
                            <ContextMenu.Separator className={MENU_SEPARATOR} />
                            <ContextMenu.Item
                                className="menu-item"
                                onClick={() => {
                                    // Selecting the node is what points the git panel at the worktree it works in.
                                    canvasStore.getState().select([id]);
                                    useUi.getState().setPanel({ open: true, kind: 'git' });
                                    const tab = worktreeDiffTab(nodeWorktree);
                                    useFiles.getState().open(tab.path, useSettings.getState().filesTabLimit, tab.view);
                                }}
                            >
                                <Icon icon={GitBranch} size={14} /> {t('menu.viewWorktree')}
                                <span className={`${MENU_HINT} font-mono`}>{nodeWorktree.branch}</span>
                            </ContextMenu.Item>
                            <ContextMenu.Item
                                className="menu-item"
                                onClick={() => useUi.getState().setWorktreeMerge({ folder: projectFolder, paths: [nodeWorktree.path] })}
                            >
                                <Icon icon={GitMerge} size={14} /> {t('menu.mergeWorktrees', { count: 1 })}
                            </ContextMenu.Item>
                            <ContextMenu.Item
                                className="menu-item"
                                onClick={() => useUi.getState().setWorktreeRemoval({ folder: projectFolder, paths: [nodeWorktree.path] })}
                            >
                                <Icon icon={Trash} size={14} /> {t('menu.removeWorktrees', { count: 1 })}
                            </ContextMenu.Item>
                            <ContextMenu.Separator className={MENU_SEPARATOR} />
                        </>
                    )}
                    {node.kind === 'terminal' && canOpenInChat && (
                        <ContextMenu.Item className="menu-item" onClick={openInChat}>
                            <Icon icon={MessageSquare} size={14} /> {t('menu.openInChat')}
                        </ContextMenu.Item>
                    )}
                    {node.kind === 'chat' && chatSession && (
                        <ContextMenu.Item className="menu-item" onClick={openInTerminal}>
                            <Icon icon={Terminal} size={14} /> {t('menu.openInTerminal')}
                        </ContextMenu.Item>
                    )}
                    {node.kind === 'chat' && <ForkMenuItem chatId={id} />}
                    {canOpenAsView(node.kind) && (
                        <ContextMenu.Item className="menu-item" onClick={() => askOpenAsView(id)}>
                            <Icon icon={Frame} size={14} /> {t('menu.openAsView')}
                            <span className={MENU_HINT}>{t('menu.openAsViewHint')}</span>
                        </ContextMenu.Item>
                    )}
                    {workingFolder && (
                        <ContextMenu.Item
                            className="menu-item"
                            onClick={() => void transport.request('fs.reveal', { path: workingFolder }).catch(() => undefined)}
                        >
                            <Icon icon={ExternalLink} size={14} /> {t('menu.reveal', { app: fileManagerName(platform) })}
                        </ContextMenu.Item>
                    )}
                    {node.kind === 'file' && filePath !== null && (
                        <>
                            <ContextMenu.Separator className={MENU_SEPARATOR} />
                            <FileActionItems path={filePath} on="node" />
                            <ContextMenu.Separator className={MENU_SEPARATOR} />
                        </>
                    )}
                    {node.kind === 'note' && (
                        <>
                            <ChatAgentSubmenu label={t('menu.startAgentFromNote')} icon={<Icon icon={Sparkles} size={14} />} onPick={startAgentFromNote} />
                            <ContextMenu.SubmenuRoot>
                                <ContextMenu.SubmenuTrigger className="menu-item">
                                    <Icon icon={Palette} size={14} /> {t('menu.noteColor')}
                                    <Icon icon={ChevronRight} size={14} className="ml-auto text-text-faint" />
                                </ContextMenu.SubmenuTrigger>
                                <ContextMenu.Portal>
                                    <ContextMenu.Positioner className="z-(--z-popup)" sideOffset={4} alignOffset={-4}>
                                        <ContextMenu.Popup className="menu-popup min-w-40">
                                            {NOTE_COLORS.map((color) => (
                                                <ContextMenu.Item
                                                    key={color.id}
                                                    className="menu-item"
                                                    onClick={() => canvasStore.getState().updateNode(id, { color: color.id })}
                                                >
                                                    <span className={`h-3 w-3 rounded-full border border-border-strong ${color.className}`} />{' '}
                                                    {t(`noteColors.${color.id}`)}
                                                    {(node.color ?? DEFAULT_NOTE_COLOR) === color.id && <Icon icon={Check} size={14} className="ml-auto" />}
                                                </ContextMenu.Item>
                                            ))}
                                        </ContextMenu.Popup>
                                    </ContextMenu.Positioner>
                                </ContextMenu.Portal>
                            </ContextMenu.SubmenuRoot>
                        </>
                    )}
                    <ContextMenu.SubmenuRoot>
                        <ContextMenu.SubmenuTrigger className="menu-item">
                            <Icon icon={Palette} size={14} /> {t('menu.color')}
                            <Icon icon={ChevronRight} size={14} className="ml-auto text-text-faint" />
                        </ContextMenu.SubmenuTrigger>
                        <ContextMenu.Portal>
                            <ContextMenu.Positioner className="z-(--z-popup)" sideOffset={4} alignOffset={-4}>
                                {/* Every hue at once, so the labels give way to a grid the eye
                                    reads in one pass; the name of a color lives in its tooltip. */}
                                <ContextMenu.Popup className="menu-popup grid min-w-0 grid-cols-6 gap-1 p-2">
                                    <Tooltip label={t('menu.noAccent')}>
                                        <ContextMenu.Item
                                            aria-label={t('menu.noAccent')}
                                            className={clsx(ACCENT_SWATCH, 'border border-border-strong text-text-muted')}
                                            onClick={() => canvasStore.getState().setNodeAccent(id, null)}
                                        >
                                            {!node.accent && <Icon icon={Check} size={12} />}
                                        </ContextMenu.Item>
                                    </Tooltip>
                                    {NODE_ACCENTS.map((a) => (
                                        <Tooltip key={a.id} label={accentLabel(a.id)}>
                                            <ContextMenu.Item
                                                aria-label={accentLabel(a.id)}
                                                className={clsx(ACCENT_SWATCH, node.accent === a.id && ACCENT_SWATCH_PICKED)}
                                                style={{ background: a.color }}
                                                onClick={() => canvasStore.getState().setNodeAccent(id, a.id)}
                                            >
                                                {node.accent === a.id && <Icon icon={Check} size={12} />}
                                            </ContextMenu.Item>
                                        </Tooltip>
                                    ))}
                                </ContextMenu.Popup>
                            </ContextMenu.Positioner>
                        </ContextMenu.Portal>
                    </ContextMenu.SubmenuRoot>
                    <ContextMenu.Separator className={MENU_SEPARATOR} />
                    <ContextMenu.Item className="menu-item text-status-error" onClick={remove}>
                        <Icon icon={Trash} size={14} /> {t('common:action.delete')} <Kbd shortcut={CANVAS_SHORTCUTS.deleteSelection} />
                    </ContextMenu.Item>
                </ContextMenu.Popup>
            </ContextMenu.Positioner>
        </ContextMenu.Portal>
    );
}

/* A node of a kind a newer Ruimte made: this version can find it and remove it, and nothing more. */
function UnknownNodeMenuPopup({ id, onDelete }: { id: string; onDelete(): void }) {
    const { t } = useTranslation('canvas');
    const canvasStore = useCanvasStore();
    return (
        <ContextMenu.Portal>
            <ContextMenu.Positioner className="z-(--z-popup)">
                <ContextMenu.Popup className="menu-popup">
                    <ContextMenu.Item className="menu-item" onClick={() => canvasStore.getState().goToNode(id)}>
                        <Icon icon={Maximize2} size={14} /> {t('node.zoomTo')}
                    </ContextMenu.Item>
                    <ContextMenu.Separator className={MENU_SEPARATOR} />
                    <ContextMenu.Item className="menu-item text-status-error" onClick={onDelete}>
                        <Icon icon={Trash} size={14} /> {t('common:action.delete')} <Kbd shortcut={CANVAS_SHORTCUTS.deleteSelection} />
                    </ContextMenu.Item>
                </ContextMenu.Popup>
            </ContextMenu.Positioner>
        </ContextMenu.Portal>
    );
}
