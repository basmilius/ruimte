import type { ReactNode } from 'react';
import { Menu } from '@base-ui-components/react/menu';
import clsx from 'clsx';

interface MenuPopupProps {
    /* Which way the popup opens from its trigger. A menu hangs under it unless there is no room. */
    side?: 'top' | 'bottom' | 'left' | 'right';
    align?: 'start' | 'center' | 'end';
    sideOffset?: number;
    /* Extra on the popup itself: a minimum width, or a cap with a scroller under it. */
    className?: string;
    children: ReactNode;
}

/*
 * The shell every menu is drawn in, so the gap to its trigger and the layer it sits on are decided
 * once. `ContextMenu.Portal` and its positioner are the same components, so a context menu draws
 * its rows in this shell too, with the side and the align it positions at the pointer left out.
 */
export function MenuPopup({ side = 'bottom', align = 'start', sideOffset = 6, className, children }: MenuPopupProps) {
    return (
        <Menu.Portal>
            <Menu.Positioner className="z-(--z-popup)" side={side} align={align} sideOffset={sideOffset}>
                <Menu.Popup className={clsx('menu-popup', className)}>{children}</Menu.Popup>
            </Menu.Positioner>
        </Menu.Portal>
    );
}
