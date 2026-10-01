import { useTranslation } from 'react-i18next';
import { FileText, Globe, LayoutGrid, Maximize, MessageSquare, Scan, SquareDashedMousePointer, StickyNote, Terminal, Type } from 'lucide-react';
import { createNodeAction, createTextAction, fitAction, groupSelectionAction, selectAllAction } from '@/actions/client-actions';
import { AgentSubmenus } from '@/agents/AgentMenus';
import type { Point } from '@/canvas/math';
import { useCanvas, useCanvasStore } from '@/state/canvas';
import { shownFolderOf, useProject } from '@/state/project';
import { useUi } from '@/state/ui';
import { Icon, Kbd, ContextMenu } from '@basmilius/desktop-ui';
import { ADD_NODE_SHORTCUTS, CANVAS_SHORTCUTS } from '@/canvas/shortcuts';

/* The menu for a right-click on empty canvas; everything it adds lands where the click was. */
export function CanvasMenuPopup({ at }: { at: () => Point }) {
    const { t } = useTranslation('canvas');
    const canvasStore = useCanvasStore();
    const hasSelection = useCanvas((s) => s.selection.length > 0);
    /* A file comes out of the open folder, so a project without one has nothing to pick from. */
    const hasFolder = useProject((s) => shownFolderOf(s.current) !== null);
    const add = (kind: 'terminal' | 'chat' | 'browser' | 'group' | 'note'): void => {
        void createNodeAction(kind, { at: at() });
    };
    return (
        <ContextMenu.Popup>
            <ContextMenu.Label>{t('canvasMenu.addHere')}</ContextMenu.Label>
            <ContextMenu.Item onClick={() => add('terminal')}>
                <Icon icon={Terminal} size={14} /> {t('kinds.terminal')} <Kbd shortcut={ADD_NODE_SHORTCUTS.terminal} />
            </ContextMenu.Item>
            <ContextMenu.Item onClick={() => add('chat')}>
                <Icon icon={MessageSquare} size={14} /> {t('kinds.chat')} <Kbd shortcut={ADD_NODE_SHORTCUTS.chat} />
            </ContextMenu.Item>
            <AgentSubmenus onPick={(target, provider) => void createNodeAction(target, { provider: provider.kind, at: at() })} />
            <ContextMenu.Item onClick={() => add('browser')}>
                <Icon icon={Globe} size={14} /> {t('kinds.browser')} <Kbd shortcut={ADD_NODE_SHORTCUTS.browser} />
            </ContextMenu.Item>
            <ContextMenu.Item onClick={() => add('group')}>
                <Icon icon={LayoutGrid} size={14} /> {t('kinds.group')} <Kbd shortcut={ADD_NODE_SHORTCUTS.group} />
            </ContextMenu.Item>
            <ContextMenu.Item onClick={() => add('note')}>
                <Icon icon={StickyNote} size={14} /> {t('kinds.note')} <Kbd shortcut={ADD_NODE_SHORTCUTS.note} />
            </ContextMenu.Item>
            {hasFolder && (
                <ContextMenu.Item onClick={() => useUi.getState().openFilePicker({ kind: 'node', at: at() })}>
                    <Icon icon={FileText} size={14} /> {t('canvasMenu.file')}
                </ContextMenu.Item>
            )}
            <ContextMenu.Item onClick={() => createTextAction(at())}>
                <Icon icon={Type} size={14} /> {t('kinds.text')} <ContextMenu.Hint>{t('menu.doubleClick')}</ContextMenu.Hint>
            </ContextMenu.Item>
            <ContextMenu.Separator />
            <ContextMenu.Item disabled={!hasSelection} onClick={() => groupSelectionAction()}>
                <Icon icon={SquareDashedMousePointer} size={14} /> {t('canvasMenu.groupSelection')} <Kbd shortcut={CANVAS_SHORTCUTS.group} />
            </ContextMenu.Item>
            <ContextMenu.Item onClick={() => selectAllAction(canvasStore)}>
                <Icon icon={Scan} size={14} /> {t('common:action.selectAll')} <Kbd shortcut={CANVAS_SHORTCUTS.selectAll} />
            </ContextMenu.Item>
            <ContextMenu.Item onClick={() => fitAction()}>
                <Icon icon={Maximize} size={14} /> {t('canvasMenu.zoomToFit')} <Kbd shortcut={CANVAS_SHORTCUTS.fitAll} />
            </ContextMenu.Item>
        </ContextMenu.Popup>
    );
}
