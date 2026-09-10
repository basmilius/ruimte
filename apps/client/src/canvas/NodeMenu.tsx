import { ContextMenu } from '@base-ui-components/react/context-menu';
import {
    Check,
    ChevronRight,
    ChevronsDownUp,
    ChevronsUpDown,
    Copy,
    ExternalLink,
    GitBranch,
    Link2,
    Maximize2,
    MessageSquare,
    Palette,
    Pencil,
    Terminal,
    Trash
} from 'lucide-react';
import { NODE_ACCENTS } from '@/canvas/accents';
import { DEFAULT_NOTE_COLOR, NOTE_COLORS } from '@/canvas/note-colors';
import { useCanvas } from '@/state/canvas';
import { useChats } from '@/state/chats';
import { useProject } from '@/state/project';
import { useProviders } from '@/state/providers';
import { fileManagerName, useServer } from '@/state/server';
import { useSessions } from '@/state/sessions';
import { useUi } from '@/state/ui';
import { transport } from '@/transport';
import { Icon } from '@/ui/Icon';

/* The context menu of one node, the same from its frame and from its row in the sidebar. */
export function NodeMenuPopup({ id, onRename }: { id: string; onRename(): void }) {
    const node = useCanvas((s) => s.nodes[id]);
    const agent = useSessions((s) => s.byNodeId[id]?.agent);
    const chatSession = useChats((s) => s.byNodeId[id]?.info.agentSessionId);
    const chatCwd = useChats((s) => s.byNodeId[id]?.info.cwd);
    const chatProvider = useChats((s) => s.byNodeId[id]?.info.provider);
    const platform = useServer((s) => s.platform);
    const providers = useProviders((s) => s.providers);
    const projectFolder = useProject((s) => s.current?.folder ?? null);

    if (!node) {
        return null;
    }

    const remove = (): void => {
        const s = useCanvas.getState();
        s.select([id]);
        s.deleteSelected();
    };
    // The same CLI session can continue in the other kind of node, next to this one.
    const beside = { x: node.x + node.w + 40 + 260, y: node.y + node.h / 2 };
    // Any CLI the daemon has a chat backend for can go on in a chat node.
    const canOpenInChat = agent ? providers.some((entry) => entry.kind === agent.kind && entry.capabilities.chat) : false;
    const openInChat = (): void => {
        if (agent) {
            useCanvas
                .getState()
                .addNode('chat', beside, { title: node.title, cwd: node.cwd, resume: agent.agentSessionId, provider: agent.kind, providerFixed: true });
        }
    };
    const openInTerminal = (): void => {
        // The daemon owns the resume line: the node only says which CLI and which session.
        if (chatSession && chatProvider) {
            useCanvas.getState().addNode('terminal', beside, { title: node.title, cwd: chatCwd, provider: chatProvider, resume: chatSession });
        }
    };
    // The folder the node works in: its own, or the project's when it has none.
    const workingFolder = node.kind === 'terminal' || node.kind === 'chat' ? (node.cwd ?? chatCwd ?? projectFolder) : (node.worktree?.path ?? null);

    return (
        <ContextMenu.Portal>
            <ContextMenu.Positioner className="popup-layer">
                <ContextMenu.Popup className="menu-popup">
                    <ContextMenu.Item className="menu-item" onClick={onRename}>
                        <Icon icon={Pencil} size={14} /> Rename <span className="menu-hint">dbl-click</span>
                    </ContextMenu.Item>
                    <ContextMenu.Item className="menu-item" onClick={() => useCanvas.getState().duplicateNode(id)}>
                        <Icon icon={Copy} size={14} /> Duplicate
                    </ContextMenu.Item>
                    <ContextMenu.Item className="menu-item" onClick={() => useCanvas.getState().goToNode(id)}>
                        <Icon icon={Maximize2} size={14} /> Zoom to node
                    </ContextMenu.Item>
                    <ContextMenu.Item className="menu-item" onClick={() => useCanvas.getState().startLink(id)}>
                        <Icon icon={Link2} size={14} /> Connect to...
                        <span className="menu-hint">Then click a node</span>
                    </ContextMenu.Item>
                    {node.kind === 'group' && (
                        <>
                            <ContextMenu.Item className="menu-item" onClick={() => useCanvas.getState().toggleGroupCollapse(id)}>
                                {node.collapsed ? <Icon icon={ChevronsUpDown} size={14} /> : <Icon icon={ChevronsDownUp} size={14} />}{' '}
                                {node.collapsed ? 'Expand' : 'Collapse'}
                            </ContextMenu.Item>
                            {node.worktree ? (
                                <ContextMenu.Item className="menu-item" onClick={() => useCanvas.getState().setGroupWorktree(id, null)}>
                                    <Icon icon={GitBranch} size={14} /> Unbind worktree
                                    <span className="menu-hint">Checkout stays</span>
                                </ContextMenu.Item>
                            ) : (
                                <ContextMenu.Item className="menu-item" onClick={() => useUi.getState().setWorktreeDialogFor(id)}>
                                    <Icon icon={GitBranch} size={14} /> Bind to worktree
                                </ContextMenu.Item>
                            )}
                        </>
                    )}
                    {node.kind === 'terminal' && canOpenInChat && (
                        <ContextMenu.Item className="menu-item" onClick={openInChat}>
                            <Icon icon={MessageSquare} size={14} /> Open in chat
                        </ContextMenu.Item>
                    )}
                    {node.kind === 'chat' && chatSession && (
                        <ContextMenu.Item className="menu-item" onClick={openInTerminal}>
                            <Icon icon={Terminal} size={14} /> Open in terminal
                        </ContextMenu.Item>
                    )}
                    {workingFolder && (
                        <ContextMenu.Item
                            className="menu-item"
                            onClick={() => void transport.request('fs.reveal', { path: workingFolder }).catch(() => undefined)}
                        >
                            <Icon icon={ExternalLink} size={14} /> Reveal in {fileManagerName(platform)}
                        </ContextMenu.Item>
                    )}
                    {node.kind === 'note' && (
                        <ContextMenu.SubmenuRoot>
                            <ContextMenu.SubmenuTrigger className="menu-item">
                                <Icon icon={Palette} size={14} /> Note color
                                <Icon icon={ChevronRight} size={14} className="ml-auto text-text-faint" />
                            </ContextMenu.SubmenuTrigger>
                            <ContextMenu.Portal>
                                <ContextMenu.Positioner className="popup-layer" sideOffset={4} alignOffset={-4}>
                                    <ContextMenu.Popup className="menu-popup min-w-40">
                                        {NOTE_COLORS.map((color) => (
                                            <ContextMenu.Item
                                                key={color.id}
                                                className="menu-item"
                                                onClick={() => useCanvas.getState().updateNode(id, { color: color.id })}
                                            >
                                                <span className={`h-3 w-3 rounded-full border border-border-strong ${color.className}`} /> {color.label}
                                                {(node.color ?? DEFAULT_NOTE_COLOR) === color.id && <Icon icon={Check} size={14} className="ml-auto" />}
                                            </ContextMenu.Item>
                                        ))}
                                    </ContextMenu.Popup>
                                </ContextMenu.Positioner>
                            </ContextMenu.Portal>
                        </ContextMenu.SubmenuRoot>
                    )}
                    <ContextMenu.SubmenuRoot>
                        <ContextMenu.SubmenuTrigger className="menu-item">
                            <Icon icon={Palette} size={14} /> Color
                            <Icon icon={ChevronRight} size={14} className="ml-auto text-text-faint" />
                        </ContextMenu.SubmenuTrigger>
                        <ContextMenu.Portal>
                            <ContextMenu.Positioner className="popup-layer" sideOffset={4} alignOffset={-4}>
                                <ContextMenu.Popup className="menu-popup min-w-40">
                                    <ContextMenu.Item className="menu-item" onClick={() => useCanvas.getState().setNodeAccent(id, null)}>
                                        <span className="h-3 w-3 rounded-full border border-border-strong" /> None
                                        {!node.accent && <Icon icon={Check} size={14} className="ml-auto" />}
                                    </ContextMenu.Item>
                                    <ContextMenu.Separator className="menu-separator" />
                                    {NODE_ACCENTS.map((a) => (
                                        <ContextMenu.Item key={a.id} className="menu-item" onClick={() => useCanvas.getState().setNodeAccent(id, a.id)}>
                                            <span className="h-3 w-3 rounded-full" style={{ background: a.color }} /> {a.label}
                                            {node.accent === a.id && <Icon icon={Check} size={14} className="ml-auto" />}
                                        </ContextMenu.Item>
                                    ))}
                                </ContextMenu.Popup>
                            </ContextMenu.Positioner>
                        </ContextMenu.Portal>
                    </ContextMenu.SubmenuRoot>
                    <ContextMenu.Separator className="menu-separator" />
                    <ContextMenu.Item className="menu-item text-status-error" onClick={remove}>
                        <Icon icon={Trash} size={14} /> Delete <kbd>⌫</kbd>
                    </ContextMenu.Item>
                </ContextMenu.Popup>
            </ContextMenu.Positioner>
        </ContextMenu.Portal>
    );
}
