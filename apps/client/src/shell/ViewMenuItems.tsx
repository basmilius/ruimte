import { useTranslation } from 'react-i18next';
import { Menu } from '@base-ui-components/react/menu';
import { Copy, Frame, Pencil, Smile, Trash } from 'lucide-react';
import type { ProjectView } from '@ruimte/contracts';
import { ForkMenuItem } from '@/chat/ui/ForkMenuItem';
import { askDeleteView, askRenameView, askViewIcon, duplicateViewOf, putOnCanvas, showViewOnCanvas } from '@/project/views';
import { Icon } from '@/ui/Icon';

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
