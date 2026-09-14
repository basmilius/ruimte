import { ContextMenu } from '@base-ui-components/react/context-menu';
import { FileText, Globe, LayoutGrid, Maximize, MessageSquare, Scan, Settings, SquareDashedMousePointer, StickyNote, Terminal, Type } from 'lucide-react';
import { AgentSubmenus } from '@/agents/AgentMenus';
import { addAgentNode } from '@/agents/nodes';
import type { Point } from '@/canvas/math';
import { useCanvas, useCanvasStore, type NodeKind } from '@/state/canvas';
import { useProject } from '@/state/project';
import { useUi } from '@/state/ui';
import { MENU_HINT, MENU_LABEL, MENU_SEPARATOR } from '@/ui/classes';
import { Icon } from '@/ui/Icon';
import { ADD_NODE_SHORTCUTS, CANVAS_SHORTCUTS } from '@/canvas/shortcuts';
import { APP_SHORTCUTS } from '@/shell/shortcuts';
import { Kbd } from '@/ui/Kbd';

/* The menu for a right-click on empty canvas; everything it adds lands where the click was. */
export function CanvasMenuPopup({ at }: { at: () => Point }) {
    const canvasStore = useCanvasStore();
    const hasSelection = useCanvas((s) => s.selection.length > 0);
    /* A file comes out of the open folder, so a project without one has nothing to pick from. */
    const hasFolder = useProject((s) => s.current?.folder != null);
    const add = (kind: NodeKind): void => {
        canvasStore.getState().addNode(kind, at());
    };
    return (
        <ContextMenu.Portal>
            <ContextMenu.Positioner className="z-(--z-popup)">
                <ContextMenu.Popup className="menu-popup">
                    <div className={MENU_LABEL}>Add here</div>
                    <ContextMenu.Item className="menu-item" onClick={() => add('terminal')}>
                        <Icon icon={Terminal} size={14} /> Terminal <Kbd shortcut={ADD_NODE_SHORTCUTS.terminal} />
                    </ContextMenu.Item>
                    <ContextMenu.Item className="menu-item" onClick={() => add('chat')}>
                        <Icon icon={MessageSquare} size={14} /> Chat <Kbd shortcut={ADD_NODE_SHORTCUTS.chat} />
                    </ContextMenu.Item>
                    <AgentSubmenus onPick={(target, provider) => addAgentNode(target, provider, at())} />
                    <ContextMenu.Item className="menu-item" onClick={() => add('browser')}>
                        <Icon icon={Globe} size={14} /> Browser <Kbd shortcut={ADD_NODE_SHORTCUTS.browser} />
                    </ContextMenu.Item>
                    <ContextMenu.Item className="menu-item" onClick={() => add('group')}>
                        <Icon icon={LayoutGrid} size={14} /> Group <Kbd shortcut={ADD_NODE_SHORTCUTS.group} />
                    </ContextMenu.Item>
                    <ContextMenu.Item className="menu-item" onClick={() => add('note')}>
                        <Icon icon={StickyNote} size={14} /> Note <Kbd shortcut={ADD_NODE_SHORTCUTS.note} />
                    </ContextMenu.Item>
                    {hasFolder && (
                        <ContextMenu.Item className="menu-item" onClick={() => useUi.getState().openFilePicker({ kind: 'node', at: at() })}>
                            <Icon icon={FileText} size={14} /> File...
                        </ContextMenu.Item>
                    )}
                    <ContextMenu.Item className="menu-item" onClick={() => canvasStore.getState().addText(at())}>
                        <Icon icon={Type} size={14} /> Text <span className={MENU_HINT}>dbl-click</span>
                    </ContextMenu.Item>
                    <ContextMenu.Separator className={MENU_SEPARATOR} />
                    <ContextMenu.Item className="menu-item" disabled={!hasSelection} onClick={() => canvasStore.getState().groupSelection()}>
                        <Icon icon={SquareDashedMousePointer} size={14} /> Group selection <Kbd shortcut={CANVAS_SHORTCUTS.group} />
                    </ContextMenu.Item>
                    <ContextMenu.Item
                        className="menu-item"
                        onClick={() => {
                            const s = canvasStore.getState();
                            s.select([...s.order, ...Object.keys(s.texts)]);
                        }}
                    >
                        <Icon icon={Scan} size={14} /> Select all <Kbd shortcut={CANVAS_SHORTCUTS.selectAll} />
                    </ContextMenu.Item>
                    <ContextMenu.Item className="menu-item" onClick={() => canvasStore.getState().fitAll()}>
                        <Icon icon={Maximize} size={14} /> Zoom to fit <Kbd shortcut={CANVAS_SHORTCUTS.fitAll} />
                    </ContextMenu.Item>
                    <ContextMenu.Separator className={MENU_SEPARATOR} />
                    <ContextMenu.Item className="menu-item" onClick={() => useUi.getState().setSettings({ open: true })}>
                        <Icon icon={Settings} size={14} /> Settings <Kbd shortcut={APP_SHORTCUTS.settings} />
                    </ContextMenu.Item>
                </ContextMenu.Popup>
            </ContextMenu.Positioner>
        </ContextMenu.Portal>
    );
}
