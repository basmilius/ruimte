import { Icon, Menu } from '@adecore/ui';
import { PictureInPicture2, Undo2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDocument } from '@/state/document';
import { canMoveToMainWindow, canMoveToNewWindow, moveViewToMainWindow, moveViewToNewWindow } from './commands';

export function WindowMoveItems({ viewId, separated = false }: { viewId: string; separated?: boolean }) {
    const { t } = useTranslation('shell');
    // Subscribed for the redraw alone, since whether a view is the window's only one follows the grid.
    useDocument((s) => s.layout);
    const toNew = canMoveToNewWindow(viewId);
    const toMain = canMoveToMainWindow(viewId);

    if (!toNew && !toMain) {
        return null;
    }

    return (
        <>
            {toNew && (
                <Menu.Item onClick={() => moveViewToNewWindow(viewId)}>
                    <Icon icon={PictureInPicture2} size={14} /> {t('viewWindows.toNewWindow')}
                </Menu.Item>
            )}
            {toMain && (
                <Menu.Item onClick={() => moveViewToMainWindow(viewId)}>
                    <Icon icon={Undo2} size={14} /> {t('viewWindows.toMainWindow')}
                </Menu.Item>
            )}
            {separated && <Menu.Separator />}
        </>
    );
}
