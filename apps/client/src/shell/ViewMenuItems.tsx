import { useTranslation } from 'react-i18next';
import { Menu } from '@base-ui-components/react/menu';
import { Copy, Frame, PanelBottom, PanelRight, Pencil, Smile, Trash, X } from 'lucide-react';
import type { ProjectView } from '@ruimte/contracts';
import { ForkMenuItem } from '@/chat/ui/ForkMenuItem';
import { askDeleteView, askRenameView, askViewIcon, duplicateViewOf, freeViewFor, putOnCanvas, showViewOnCanvas, splitFocusedCell } from '@/project/views';
import { canSplit, cellCount, type CellAt, type SplitDirection } from '@/shell/split';
import { useDocument } from '@/state/document';
import { CANVAS_SHORTCUTS } from '@/canvas/shortcuts';
import { Icon } from '@/ui/Icon';
import { Kbd } from '@/ui/Kbd';

/* A view a person drew on a surface of its own is duplicated rather than moved to a canvas. */
const DRAWN_KINDS: readonly ProjectView['kind'][] = ['canvas', 'drawing', 'diagram'];

/*
 * Everything a view can be asked, as menu items. The sidebar's right click, the view menu in the
 * toolbar and the right click on a cell's bar offer the same list in the same order, so the three
 * never drift apart; `ContextMenu` draws a `Menu.Item` as its own.
 */
export function ViewMenuItems({ viewId, kind, onRename }: { viewId: string; kind: ProjectView['kind']; onRename?: () => void }) {
    const { t } = useTranslation(['shell', 'common']);
    const drawn = DRAWN_KINDS.includes(kind);
    return (
        <>
            <Menu.Item className="menu-item" onClick={() => (onRename === undefined ? askRenameView(viewId) : onRename())}>
                <Icon icon={Pencil} size={14} /> {t('common:action.rename')} {onRename !== undefined && <kbd>F2</kbd>}
            </Menu.Item>
            <Menu.Item className="menu-item" onClick={() => askViewIcon(viewId)}>
                <Icon icon={Smile} size={14} /> {t('viewMenu.changeIcon')}
            </Menu.Item>
            {drawn && (
                <Menu.Item className="menu-item" onClick={() => duplicateViewOf(viewId)}>
                    <Icon icon={Copy} size={14} /> {t('sidebar.duplicate')}
                </Menu.Item>
            )}
            {!drawn && kind !== 'file' && (
                <Menu.Item className="menu-item" onClick={() => putOnCanvas(viewId)}>
                    <Icon icon={Frame} size={14} /> {t('viewMenu.putOnCanvas')}
                </Menu.Item>
            )}
            {kind === 'chat' && <ForkMenuItem chatId={viewId} />}
            {(kind === 'drawing' || kind === 'diagram' || kind === 'file') && (
                <Menu.Item className="menu-item" onClick={() => showViewOnCanvas(viewId)}>
                    <Icon icon={Frame} size={14} /> {t('viewMenu.showOnCanvas')}
                </Menu.Item>
            )}
            <Menu.Item className="menu-item text-status-error" onClick={() => askDeleteView(viewId)}>
                <Icon icon={Trash} size={14} /> {t('common:action.delete')}
            </Menu.Item>
        </>
    );
}

/*
 * Putting a view beside the one on screen, and closing the one it sits in. Which view lands there is
 * the same question the shortcut answers (`freeViewFor`): the first one that is not standing
 * anywhere yet, since a view is in at most one cell. With every view already up, or with the grid
 * full, the row is not offered. Without an `at` the rows act on the focused cell, which is what the
 * toolbar's menu wants; a cell's own bar names itself and takes the focus first, because a split
 * always lands beside the focus.
 */
export function SplitItems({ at }: { at?: CellAt }) {
    const { t } = useTranslation('shell');
    const layout = useDocument((s) => s.layout);
    const free = useDocument(freeViewFor);
    const cell = at ?? layout?.focus ?? null;
    const closable = layout !== null && cellCount(layout) > 1;
    const room = (direction: SplitDirection): boolean => layout !== null && free !== null && cell !== null && canSplit(layout, cell, direction, free);
    if (!room('right') && !room('down') && !closable) {
        return null;
    }
    const split = (direction: SplitDirection): void => {
        if (at !== undefined) {
            useDocument.getState().focusCellAt(at);
        }
        splitFocusedCell(direction);
    };
    return (
        <>
            {room('right') && (
                <Menu.Item className="menu-item" onClick={() => split('right')}>
                    <Icon icon={PanelRight} size={14} /> {t('viewMenu.splitRight')} <Kbd shortcut={CANVAS_SHORTCUTS.splitRight} />
                </Menu.Item>
            )}
            {room('down') && (
                <Menu.Item className="menu-item" onClick={() => split('down')}>
                    <Icon icon={PanelBottom} size={14} /> {t('viewMenu.splitDown')} <Kbd shortcut={CANVAS_SHORTCUTS.splitDown} />
                </Menu.Item>
            )}
            {closable && cell !== null && (
                <Menu.Item className="menu-item" onClick={() => useDocument.getState().closeCellAt(cell)}>
                    <Icon icon={X} size={14} /> {t('cellToolbar.closeCell')} <Kbd shortcut={CANVAS_SHORTCUTS.closeCell} />
                </Menu.Item>
            )}
        </>
    );
}
