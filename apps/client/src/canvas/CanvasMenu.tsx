import { ContextMenu } from '@base-ui-components/react/context-menu';
import { Globe, LayoutGrid, Maximize, MessageSquare, Scan, Settings, SquareDashedMousePointer, StickyNote, Terminal, Type } from 'lucide-react';
import { AgentSubmenus } from '@/agents/AgentMenus';
import { addAgentNode } from '@/agents/nodes';
import type { Point } from '@/canvas/math';
import { useCanvas, type NodeKind } from '@/state/canvas';
import { useUi } from '@/state/ui';

/* The menu for a right-click on empty canvas; everything it adds lands where the click was. */
export function CanvasMenuPopup({ at }: { at: () => Point }) {
    const hasSelection = useCanvas((s) => s.selection.length > 0);
    const add = (kind: NodeKind): void => {
        useCanvas.getState().addNode(kind, at());
    };
    return (
        <ContextMenu.Portal>
            <ContextMenu.Positioner className="z-50">
                <ContextMenu.Popup className="menu-popup">
                    <div className="menu-label">Add here</div>
                    <ContextMenu.Item className="menu-item" onClick={() => add('terminal')}>
                        <Terminal size={14} /> Terminal <kbd>⌥T</kbd>
                    </ContextMenu.Item>
                    <ContextMenu.Item className="menu-item" onClick={() => add('chat')}>
                        <MessageSquare size={14} /> Chat <kbd>⌥C</kbd>
                    </ContextMenu.Item>
                    <AgentSubmenus onPick={(target, provider) => addAgentNode(target, provider, at())} />
                    <ContextMenu.Item className="menu-item" onClick={() => add('browser')}>
                        <Globe size={14} /> Browser <kbd>⌥B</kbd>
                    </ContextMenu.Item>
                    <ContextMenu.Item className="menu-item" onClick={() => add('group')}>
                        <LayoutGrid size={14} /> Group <kbd>⌥G</kbd>
                    </ContextMenu.Item>
                    <ContextMenu.Item className="menu-item" onClick={() => add('note')}>
                        <StickyNote size={14} /> Note <kbd>⌥N</kbd>
                    </ContextMenu.Item>
                    <ContextMenu.Item className="menu-item" onClick={() => useCanvas.getState().addText(at())}>
                        <Type size={14} /> Text <kbd>dbl-click</kbd>
                    </ContextMenu.Item>
                    <ContextMenu.Separator className="menu-separator" />
                    <ContextMenu.Item className="menu-item" disabled={!hasSelection} onClick={() => useCanvas.getState().groupSelection()}>
                        <SquareDashedMousePointer size={14} /> Group selection <kbd>⌘G</kbd>
                    </ContextMenu.Item>
                    <ContextMenu.Item
                        className="menu-item"
                        onClick={() => {
                            const s = useCanvas.getState();
                            s.select([...s.order, ...Object.keys(s.texts)]);
                        }}
                    >
                        <Scan size={14} /> Select all <kbd>⌘A</kbd>
                    </ContextMenu.Item>
                    <ContextMenu.Item className="menu-item" onClick={() => useCanvas.getState().fitAll()}>
                        <Maximize size={14} /> Zoom to fit <kbd>⇧1</kbd>
                    </ContextMenu.Item>
                    <ContextMenu.Separator className="menu-separator" />
                    <ContextMenu.Item className="menu-item" onClick={() => useUi.getState().setSettings({ open: true })}>
                        <Settings size={14} /> Settings <kbd>⌘,</kbd>
                    </ContextMenu.Item>
                </ContextMenu.Popup>
            </ContextMenu.Positioner>
        </ContextMenu.Portal>
    );
}
