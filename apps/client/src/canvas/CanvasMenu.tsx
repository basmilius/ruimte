import { ContextMenu } from '@base-ui-components/react/context-menu';
import { useTranslation } from 'react-i18next';
import { FileText, Globe, LayoutGrid, Maximize, MessageSquare, Scan, SquareDashedMousePointer, StickyNote, Terminal, Type } from 'lucide-react';
import { createNodeAction, createTextAction, fitAction, groupSelectionAction, selectAllAction } from '@/actions/client-actions';
import { AgentSubmenus } from '@/agents/AgentMenus';
import type { Point } from '@/canvas/math';
import { useCanvas, useCanvasStore } from '@/state/canvas';
import { useProject } from '@/state/project';
import { useUi } from '@/state/ui';
import { MENU_HINT, MENU_LABEL, MENU_SEPARATOR } from '@ruimte/ui/classes';
import { Icon } from '@ruimte/ui/Icon';
import { ADD_NODE_SHORTCUTS, CANVAS_SHORTCUTS } from '@/canvas/shortcuts';
import { Kbd } from '@ruimte/ui/Kbd';

/* The menu for a right-click on empty canvas; everything it adds lands where the click was. */
export function CanvasMenuPopup({ at }: { at: () => Point }) {
    const { t } = useTranslation('canvas');
    const canvasStore = useCanvasStore();
    const hasSelection = useCanvas((s) => s.selection.length > 0);
    /* A file comes out of the open folder, so a project without one has nothing to pick from. */
    const hasFolder = useProject((s) => s.current?.folder != null);
    const add = (kind: 'terminal' | 'chat' | 'browser' | 'group' | 'note'): void => {
        void createNodeAction(kind, { at: at() });
    };
    return (
        <ContextMenu.Portal>
            <ContextMenu.Positioner className="z-(--z-popup)">
                <ContextMenu.Popup className="menu-popup">
                    <div className={MENU_LABEL}>{t('canvasMenu.addHere')}</div>
                    <ContextMenu.Item className="menu-item" onClick={() => add('terminal')}>
                        <Icon icon={Terminal} size={14} /> {t('kinds.terminal')} <Kbd shortcut={ADD_NODE_SHORTCUTS.terminal} />
                    </ContextMenu.Item>
                    <ContextMenu.Item className="menu-item" onClick={() => add('chat')}>
                        <Icon icon={MessageSquare} size={14} /> {t('kinds.chat')} <Kbd shortcut={ADD_NODE_SHORTCUTS.chat} />
                    </ContextMenu.Item>
                    <AgentSubmenus onPick={(target, provider) => void createNodeAction(target, { provider: provider.kind, at: at() })} />
                    <ContextMenu.Item className="menu-item" onClick={() => add('browser')}>
                        <Icon icon={Globe} size={14} /> {t('kinds.browser')} <Kbd shortcut={ADD_NODE_SHORTCUTS.browser} />
                    </ContextMenu.Item>
                    <ContextMenu.Item className="menu-item" onClick={() => add('group')}>
                        <Icon icon={LayoutGrid} size={14} /> {t('kinds.group')} <Kbd shortcut={ADD_NODE_SHORTCUTS.group} />
                    </ContextMenu.Item>
                    <ContextMenu.Item className="menu-item" onClick={() => add('note')}>
                        <Icon icon={StickyNote} size={14} /> {t('kinds.note')} <Kbd shortcut={ADD_NODE_SHORTCUTS.note} />
                    </ContextMenu.Item>
                    {hasFolder && (
                        <ContextMenu.Item className="menu-item" onClick={() => useUi.getState().openFilePicker({ kind: 'node', at: at() })}>
                            <Icon icon={FileText} size={14} /> {t('canvasMenu.file')}
                        </ContextMenu.Item>
                    )}
                    <ContextMenu.Item className="menu-item" onClick={() => createTextAction(at())}>
                        <Icon icon={Type} size={14} /> {t('kinds.text')} <span className={MENU_HINT}>{t('menu.doubleClick')}</span>
                    </ContextMenu.Item>
                    <ContextMenu.Separator className={MENU_SEPARATOR} />
                    <ContextMenu.Item className="menu-item" disabled={!hasSelection} onClick={() => groupSelectionAction()}>
                        <Icon icon={SquareDashedMousePointer} size={14} /> {t('canvasMenu.groupSelection')} <Kbd shortcut={CANVAS_SHORTCUTS.group} />
                    </ContextMenu.Item>
                    <ContextMenu.Item className="menu-item" onClick={() => selectAllAction(canvasStore)}>
                        <Icon icon={Scan} size={14} /> {t('common:action.selectAll')} <Kbd shortcut={CANVAS_SHORTCUTS.selectAll} />
                    </ContextMenu.Item>
                    <ContextMenu.Item className="menu-item" onClick={() => fitAction()}>
                        <Icon icon={Maximize} size={14} /> {t('canvasMenu.zoomToFit')} <Kbd shortcut={CANVAS_SHORTCUTS.fitAll} />
                    </ContextMenu.Item>
                </ContextMenu.Popup>
            </ContextMenu.Positioner>
        </ContextMenu.Portal>
    );
}
