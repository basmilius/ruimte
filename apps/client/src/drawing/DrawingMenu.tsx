import { Icon, Kbd, ContextMenu } from '@adecore/ui';
import {
    ArrowDownToLine,
    ArrowUpToLine,
    ClipboardPaste,
    Copy,
    Layers,
    Lock,
    LockOpen,
    Maximize,
    Redo2,
    Scan,
    Scissors,
    Trash,
    Undo2,
    ZoomIn
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { fitAction, historyAction } from '@/action-port/person-actions';
import { copyDrawing, cutSelection, deleteSelection, duplicateSelection, pasteInto, reorderSelection, toggleLockSelection } from '@/drawing/drawing-actions';
import { DRAWING_SHORTCUTS } from '@/drawing/shortcuts';
import { useDrawing, useDrawingStore } from '@/state/drawing';

/* Every item here is a key `use-drawing-keys.ts` binds; the menu shows them to a person who never learned the keys. */
export function DrawingMenuPopup() {
    const { t } = useTranslation('drawing');
    const store = useDrawingStore();
    const viewId = useDrawing((s) => s.viewId);
    const selection = useDrawing((s) => s.selection.length);
    const elements = useDrawing((s) => s.elements.length);
    const canUndo = useDrawing((s) => s.past.length > 0);
    const canRedo = useDrawing((s) => s.future.length > 0);
    const locked = useDrawing((s) => s.selection.length > 0 && s.elements.filter((el) => s.selection.includes(el.id)).every((el) => el.locked === true));
    const has = selection > 0;

    return (
        <ContextMenu.Popup>
            <ContextMenu.Item disabled={!canUndo} onClick={() => historyAction('undo', viewId)}>
                <Icon icon={Undo2} size={14} /> {t('common:action.undo')} <Kbd shortcut={DRAWING_SHORTCUTS.undo} />
            </ContextMenu.Item>
            <ContextMenu.Item disabled={!canRedo} onClick={() => historyAction('redo', viewId)}>
                <Icon icon={Redo2} size={14} /> {t('common:action.redo')} <Kbd shortcut={DRAWING_SHORTCUTS.redo} />
            </ContextMenu.Item>
            <ContextMenu.Separator />
            <ContextMenu.Item disabled={!has} onClick={() => void cutSelection(store)}>
                <Icon icon={Scissors} size={14} /> {t('menu.cut')} <Kbd shortcut={DRAWING_SHORTCUTS.cut} />
            </ContextMenu.Item>
            <ContextMenu.Item disabled={!has} onClick={() => void copyDrawing(store, 'elements')}>
                <Icon icon={Copy} size={14} /> {t('common:action.copy')} <Kbd shortcut={DRAWING_SHORTCUTS.copy} />
            </ContextMenu.Item>
            <ContextMenu.Item onClick={() => void pasteInto(store)}>
                <Icon icon={ClipboardPaste} size={14} /> {t('menu.paste')} <Kbd shortcut={DRAWING_SHORTCUTS.paste} />
            </ContextMenu.Item>
            <ContextMenu.Item disabled={!has} onClick={() => duplicateSelection(store)}>
                <Icon icon={Copy} size={14} /> {t('menu.duplicate')} <Kbd shortcut={DRAWING_SHORTCUTS.duplicate} />
            </ContextMenu.Item>
            <ContextMenu.Separator />
            <ContextMenu.SubmenuRoot>
                <ContextMenu.SubmenuTrigger disabled={!has}>
                    <Icon icon={Layers} size={14} /> {t('menu.arrange')}
                </ContextMenu.SubmenuTrigger>
                <ContextMenu.Popup>
                    <ContextMenu.Item disabled={!has} onClick={() => reorderSelection(store, 'front')}>
                        <Icon icon={ArrowUpToLine} size={14} /> {t('menu.bringToFront')} <Kbd shortcut={DRAWING_SHORTCUTS.bringToFront} />
                    </ContextMenu.Item>
                    <ContextMenu.Item disabled={!has} onClick={() => reorderSelection(store, 'back')}>
                        <Icon icon={ArrowDownToLine} size={14} /> {t('menu.sendToBack')} <Kbd shortcut={DRAWING_SHORTCUTS.sendToBack} />
                    </ContextMenu.Item>
                    <ContextMenu.Separator />
                    <ContextMenu.Item disabled={!has} onClick={() => toggleLockSelection(store)}>
                        <Icon icon={locked ? LockOpen : Lock} size={14} /> {locked ? t('menu.unlock') : t('menu.lock')}{' '}
                        <Kbd shortcut={DRAWING_SHORTCUTS.lock} />
                    </ContextMenu.Item>
                </ContextMenu.Popup>
            </ContextMenu.SubmenuRoot>
            <ContextMenu.SubmenuRoot>
                <ContextMenu.SubmenuTrigger disabled={elements === 0}>
                    <Icon icon={ZoomIn} size={14} /> {t('menu.zoom')}
                </ContextMenu.SubmenuTrigger>
                <ContextMenu.Popup>
                    <ContextMenu.Item disabled={elements === 0} onClick={() => fitAction(viewId)}>
                        <Icon icon={Maximize} size={14} /> {t('zoom.fitEverything')} <Kbd shortcut={DRAWING_SHORTCUTS.fitAll} />
                    </ContextMenu.Item>
                    <ContextMenu.Item disabled={!has} onClick={() => store.getState().zoomToSelection()}>
                        <Icon icon={Scan} size={14} /> {t('zoom.selection')} <Kbd shortcut={DRAWING_SHORTCUTS.zoomSelection} />
                    </ContextMenu.Item>
                </ContextMenu.Popup>
            </ContextMenu.SubmenuRoot>
            <ContextMenu.Item disabled={elements === 0} onClick={() => store.getState().selectAll()}>
                <Icon icon={Scan} size={14} /> {t('common:action.selectAll')} <Kbd shortcut={DRAWING_SHORTCUTS.selectAll} />
            </ContextMenu.Item>
            <ContextMenu.Separator />
            <ContextMenu.Item className="text-status-error" disabled={!has} onClick={() => void deleteSelection(store)}>
                <Icon icon={Trash} size={14} /> {t('common:action.delete')} <kbd>⌫</kbd>
            </ContextMenu.Item>
        </ContextMenu.Popup>
    );
}
