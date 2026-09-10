import { ContextMenu } from '@base-ui-components/react/context-menu';
import { Globe, LayoutGrid, Maximize, MessageSquare, Scan, Settings, SquareDashedMousePointer, StickyNote, Terminal, Type } from 'lucide-react';
import { AgentSubmenus } from '@/agents/AgentMenus';
import { addAgentNode } from '@/agents/nodes';
import type { Point } from '@/canvas/math';
import { useCanvas, type NodeKind } from '@/state/canvas';
import { useUi } from '@/state/ui';
import { Icon } from '@/ui/Icon';

/* The menu for a right-click on empty canvas; everything it adds lands where the click was. */
export function CanvasMenuPopup({ at }: { at: () => Point }) {
    const hasSelection = useCanvas((s) => s.selection.length > 0);
    const add = (kind: NodeKind): void => {
        useCanvas.getState().addNode(kind, at());
    };
    return (
        <ContextMenu.Portal>
            <ContextMenu.Positioner className="popup-layer">
                <ContextMenu.Popup className="menu-popup">
                    <div className="menu-label">Add here</div>
                    <ContextMenu.Item className="menu-item" onClick={() => add('terminal')}>
                        <Icon icon={Terminal} size={14} /> Terminal <kbd>⌥T</kbd>
                    </ContextMenu.Item>
                    <ContextMenu.Item className="menu-item" onClick={() => add('chat')}>
                        <Icon icon={MessageSquare} size={14} /> Chat <kbd>⌥C</kbd>
                    </ContextMenu.Item>
                    <AgentSubmenus onPick={(target, provider) => addAgentNode(target, provider, at())} />
                    <ContextMenu.Item className="menu-item" onClick={() => add('browser')}>
                        <Icon icon={Globe} size={14} /> Browser <kbd>⌥B</kbd>
                    </ContextMenu.Item>
                    <ContextMenu.Item className="menu-item" onClick={() => add('group')}>
                        <Icon icon={LayoutGrid} size={14} /> Group <kbd>⌥G</kbd>
                    </ContextMenu.Item>
                    <ContextMenu.Item className="menu-item" onClick={() => add('note')}>
                        <Icon icon={StickyNote} size={14} /> Note <kbd>⌥N</kbd>
                    </ContextMenu.Item>
                    <ContextMenu.Item className="menu-item" onClick={() => useCanvas.getState().addText(at())}>
                        <Icon icon={Type} size={14} /> Text <span className="menu-hint">dbl-click</span>
                    </ContextMenu.Item>
                    <ContextMenu.Separator className="menu-separator" />
                    <ContextMenu.Item className="menu-item" disabled={!hasSelection} onClick={() => useCanvas.getState().groupSelection()}>
                        <Icon icon={SquareDashedMousePointer} size={14} /> Group selection <kbd>⌘G</kbd>
                    </ContextMenu.Item>
                    <ContextMenu.Item
                        className="menu-item"
                        onClick={() => {
                            const s = useCanvas.getState();
                            s.select([...s.order, ...Object.keys(s.texts)]);
                        }}
                    >
                        <Icon icon={Scan} size={14} /> Select all <kbd>⌘A</kbd>
                    </ContextMenu.Item>
                    <ContextMenu.Item className="menu-item" onClick={() => useCanvas.getState().fitAll()}>
                        <Icon icon={Maximize} size={14} /> Zoom to fit <kbd>⇧1</kbd>
                    </ContextMenu.Item>
                    <ContextMenu.Separator className="menu-separator" />
                    <ContextMenu.Item className="menu-item" onClick={() => useUi.getState().setSettings({ open: true })}>
                        <Icon icon={Settings} size={14} /> Settings <kbd>⌘,</kbd>
                    </ContextMenu.Item>
                </ContextMenu.Popup>
            </ContextMenu.Positioner>
        </ContextMenu.Portal>
    );
}
