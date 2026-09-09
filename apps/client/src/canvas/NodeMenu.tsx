import { ContextMenu } from '@base-ui-components/react/context-menu';
import {
    Check,
    ChevronRight,
    ChevronsDownUp,
    ChevronsUpDown,
    Copy,
    ExternalLink,
    GitBranch,
    Keyboard,
    Link2,
    Maximize2,
    MessageSquare,
    Palette,
    Pencil,
    Terminal,
    Trash2
} from 'lucide-react';
import { NODE_ACCENTS } from '@/canvas/accents';
import { DEFAULT_NOTE_COLOR, NOTE_COLORS } from '@/canvas/note-colors';
import { useCanvas } from '@/state/canvas';
import { useChats } from '@/state/chats';
import { useProject } from '@/state/project';
import { fileManagerName, useServer } from '@/state/server';
import { useSessions } from '@/state/sessions';
import { useUi } from '@/state/ui';
import { transport } from '@/transport';

/* The context menu of one node, the same from its frame and from its row in the sidebar. */
export function NodeMenuPopup({ id, onRename }: { id: string; onRename(): void }) {
    const node = useCanvas((s) => s.nodes[id]);
    const agent = useSessions((s) => s.byNodeId[id]?.agent);
    const chatSession = useChats((s) => s.byNodeId[id]?.info.agentSessionId);
    const chatCwd = useChats((s) => s.byNodeId[id]?.info.cwd);
    const chatProvider = useChats((s) => s.byNodeId[id]?.info.provider);
    const platform = useServer((s) => s.platform);
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
    const openInChat = (): void => {
        if (agent?.kind === 'claude') {
            useCanvas.getState().addNode('chat', beside, { title: node.title, cwd: node.cwd, resume: agent.agentSessionId, provider: agent.kind });
        }
    };
    const openInTerminal = (): void => {
        if (chatSession) {
            const command = chatProvider === 'codex' ? `codex resume ${chatSession}` : `claude --resume ${chatSession}`;
            useCanvas.getState().addNode('terminal', beside, { title: node.title, cwd: chatCwd, command });
        }
    };
    // The folder the node works in: its own, or the project's when it has none.
    const workingFolder = node.kind === 'terminal' || node.kind === 'chat' ? (node.cwd ?? chatCwd ?? projectFolder) : (node.worktree?.path ?? null);

    return (
        <ContextMenu.Portal>
            <ContextMenu.Positioner className="z-50">
                <ContextMenu.Popup className="menu-popup">
                    <ContextMenu.Item className="menu-item" onClick={onRename}>
                        <Pencil size={14} /> Rename <kbd>dbl-click</kbd>
                    </ContextMenu.Item>
                    <ContextMenu.Item className="menu-item" onClick={() => useCanvas.getState().duplicateNode(id)}>
                        <Copy size={14} /> Duplicate
                    </ContextMenu.Item>
                    <ContextMenu.Item className="menu-item" onClick={() => useCanvas.getState().goToNode(id)}>
                        <Maximize2 size={14} /> Zoom to node
                    </ContextMenu.Item>
                    <ContextMenu.Item className="menu-item" onClick={() => useCanvas.getState().startLink(id)}>
                        <Link2 size={14} /> Connect to...
                        <span className="ml-auto text-[11px] text-text-faint">Then click a node</span>
                    </ContextMenu.Item>
                    {node.kind === 'group' && (
                        <>
                            <ContextMenu.Item className="menu-item" onClick={() => useCanvas.getState().toggleGroupCollapse(id)}>
                                {node.collapsed ? <ChevronsUpDown size={14} /> : <ChevronsDownUp size={14} />} {node.collapsed ? 'Expand' : 'Collapse'}
                            </ContextMenu.Item>
                            {node.worktree ? (
                                <ContextMenu.Item className="menu-item" onClick={() => useCanvas.getState().setGroupWorktree(id, null)}>
                                    <GitBranch size={14} /> Unbind worktree
                                    <span className="ml-auto text-[11px] text-text-faint">Checkout stays</span>
                                </ContextMenu.Item>
                            ) : (
                                <ContextMenu.Item className="menu-item" onClick={() => useUi.getState().setWorktreeDialogFor(id)}>
                                    <GitBranch size={14} /> Bind to worktree
                                </ContextMenu.Item>
                            )}
                        </>
                    )}
                    {node.kind === 'terminal' && (
                        <ContextMenu.Item className="menu-item" onClick={() => useCanvas.getState().updateNode(id, { escapeToApp: !node.escapeToApp })}>
                            <Keyboard size={14} /> Send Escape to the app
                            {node.escapeToApp ? <Check size={13} className="ml-auto" /> : <kbd>⌘Esc leaves</kbd>}
                        </ContextMenu.Item>
                    )}
                    {node.kind === 'terminal' && agent?.kind === 'claude' && (
                        <ContextMenu.Item className="menu-item" onClick={openInChat}>
                            <MessageSquare size={14} /> Open in chat
                        </ContextMenu.Item>
                    )}
                    {node.kind === 'chat' && chatSession && (
                        <ContextMenu.Item className="menu-item" onClick={openInTerminal}>
                            <Terminal size={14} /> Open in terminal
                        </ContextMenu.Item>
                    )}
                    {workingFolder && (
                        <ContextMenu.Item
                            className="menu-item"
                            onClick={() => void transport.request('fs.reveal', { path: workingFolder }).catch(() => undefined)}
                        >
                            <ExternalLink size={14} /> Reveal in {fileManagerName(platform)}
                        </ContextMenu.Item>
                    )}
                    {node.kind === 'note' && (
                        <ContextMenu.SubmenuRoot>
                            <ContextMenu.SubmenuTrigger className="menu-item">
                                <Palette size={14} /> Note color
                                <ChevronRight size={14} className="ml-auto text-text-faint" />
                            </ContextMenu.SubmenuTrigger>
                            <ContextMenu.Portal>
                                <ContextMenu.Positioner className="z-50" sideOffset={4} alignOffset={-4}>
                                    <ContextMenu.Popup className="menu-popup min-w-40">
                                        {NOTE_COLORS.map((color) => (
                                            <ContextMenu.Item
                                                key={color.id}
                                                className="menu-item"
                                                onClick={() => useCanvas.getState().updateNode(id, { color: color.id })}
                                            >
                                                <span className={`h-3 w-3 rounded-full border border-border-strong ${color.className}`} /> {color.label}
                                                {(node.color ?? DEFAULT_NOTE_COLOR) === color.id && <Check size={13} className="ml-auto" />}
                                            </ContextMenu.Item>
                                        ))}
                                    </ContextMenu.Popup>
                                </ContextMenu.Positioner>
                            </ContextMenu.Portal>
                        </ContextMenu.SubmenuRoot>
                    )}
                    <ContextMenu.SubmenuRoot>
                        <ContextMenu.SubmenuTrigger className="menu-item">
                            <Palette size={14} /> Color
                            <ChevronRight size={14} className="ml-auto text-text-faint" />
                        </ContextMenu.SubmenuTrigger>
                        <ContextMenu.Portal>
                            <ContextMenu.Positioner className="z-50" sideOffset={4} alignOffset={-4}>
                                <ContextMenu.Popup className="menu-popup min-w-40">
                                    <ContextMenu.Item className="menu-item" onClick={() => useCanvas.getState().setNodeAccent(id, null)}>
                                        <span className="h-3 w-3 rounded-full border border-border-strong" /> None
                                        {!node.accent && <Check size={13} className="ml-auto" />}
                                    </ContextMenu.Item>
                                    <ContextMenu.Separator className="menu-separator" />
                                    {NODE_ACCENTS.map((a) => (
                                        <ContextMenu.Item key={a.id} className="menu-item" onClick={() => useCanvas.getState().setNodeAccent(id, a.id)}>
                                            <span className="h-3 w-3 rounded-full" style={{ background: a.color }} /> {a.label}
                                            {node.accent === a.id && <Check size={13} className="ml-auto" />}
                                        </ContextMenu.Item>
                                    ))}
                                </ContextMenu.Popup>
                            </ContextMenu.Positioner>
                        </ContextMenu.Portal>
                    </ContextMenu.SubmenuRoot>
                    <ContextMenu.Separator className="menu-separator" />
                    <ContextMenu.Item className="menu-item text-status-error" onClick={remove}>
                        <Trash2 size={14} /> Delete <kbd>⌫</kbd>
                    </ContextMenu.Item>
                </ContextMenu.Popup>
            </ContextMenu.Positioner>
        </ContextMenu.Portal>
    );
}
