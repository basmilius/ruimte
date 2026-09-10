import { ContextMenu } from '@base-ui-components/react/context-menu';
import {
    faCropSimple,
    faExpand,
    faFont,
    faGear,
    faGlobe,
    faGrid2,
    faMessage,
    faNoteSticky,
    faObjectGroup,
    faTerminal
} from '@fortawesome/duotone-regular-svg-icons';
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
            <ContextMenu.Positioner className="z-50">
                <ContextMenu.Popup className="menu-popup">
                    <div className="menu-label">Add here</div>
                    <ContextMenu.Item className="menu-item" onClick={() => add('terminal')}>
                        <Icon icon={faTerminal} size={14} /> Terminal <kbd>⌥T</kbd>
                    </ContextMenu.Item>
                    <ContextMenu.Item className="menu-item" onClick={() => add('chat')}>
                        <Icon icon={faMessage} size={14} /> Chat <kbd>⌥C</kbd>
                    </ContextMenu.Item>
                    <AgentSubmenus onPick={(target, provider) => addAgentNode(target, provider, at())} />
                    <ContextMenu.Item className="menu-item" onClick={() => add('browser')}>
                        <Icon icon={faGlobe} size={14} /> Browser <kbd>⌥B</kbd>
                    </ContextMenu.Item>
                    <ContextMenu.Item className="menu-item" onClick={() => add('group')}>
                        <Icon icon={faGrid2} size={14} /> Group <kbd>⌥G</kbd>
                    </ContextMenu.Item>
                    <ContextMenu.Item className="menu-item" onClick={() => add('note')}>
                        <Icon icon={faNoteSticky} size={14} /> Note <kbd>⌥N</kbd>
                    </ContextMenu.Item>
                    <ContextMenu.Item className="menu-item" onClick={() => useCanvas.getState().addText(at())}>
                        <Icon icon={faFont} size={14} /> Text <kbd>dbl-click</kbd>
                    </ContextMenu.Item>
                    <ContextMenu.Separator className="menu-separator" />
                    <ContextMenu.Item className="menu-item" disabled={!hasSelection} onClick={() => useCanvas.getState().groupSelection()}>
                        <Icon icon={faObjectGroup} size={14} /> Group selection <kbd>⌘G</kbd>
                    </ContextMenu.Item>
                    <ContextMenu.Item
                        className="menu-item"
                        onClick={() => {
                            const s = useCanvas.getState();
                            s.select([...s.order, ...Object.keys(s.texts)]);
                        }}
                    >
                        <Icon icon={faCropSimple} size={14} /> Select all <kbd>⌘A</kbd>
                    </ContextMenu.Item>
                    <ContextMenu.Item className="menu-item" onClick={() => useCanvas.getState().fitAll()}>
                        <Icon icon={faExpand} size={14} /> Zoom to fit <kbd>⇧1</kbd>
                    </ContextMenu.Item>
                    <ContextMenu.Separator className="menu-separator" />
                    <ContextMenu.Item className="menu-item" onClick={() => useUi.getState().setSettings({ open: true })}>
                        <Icon icon={faGear} size={14} /> Settings <kbd>⌘,</kbd>
                    </ContextMenu.Item>
                </ContextMenu.Popup>
            </ContextMenu.Positioner>
        </ContextMenu.Portal>
    );
}
