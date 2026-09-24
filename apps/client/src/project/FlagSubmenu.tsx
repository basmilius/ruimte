import { useTranslation } from 'react-i18next';
import { Menu } from '@base-ui-components/react/menu';
import { ChevronRight, FlagOff, Flag } from 'lucide-react';
import { flagOf } from '@ruimte/contracts';
import { flagAction } from '@/actions/client-actions';
import { accentLabel, NODE_ACCENTS } from '@/canvas/accents';
import { useDocument } from '@/state/document';
import { MENU_SEPARATOR } from '@/ui/classes';
import { Icon } from '@/ui/Icon';
import { MenuCheck } from '@/ui/MenuCheck';

function ColorItem({ ids, entry, picked }: { ids: readonly string[]; entry: (typeof NODE_ACCENTS)[number]; picked: boolean }) {
    return (
        <Menu.Item className="menu-item" onClick={() => flagAction(ids, entry.id)}>
            <MenuCheck kind="radio" checked={picked} />
            <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: entry.color }} aria-hidden />
            <span className="grow">{accentLabel(entry.id)}</span>
        </Menu.Item>
    );
}

/*
 * "Flag" in the menu of a view and of a node. The colors are the node accents in their wheel order;
 * only they scroll, so "Remove flag" stays in sight at the bottom of a short window.
 */
export function FlagSubmenu({ id }: { id: string }) {
    const { t } = useTranslation('project');
    const flag = useDocument((state) => flagOf(state.flags, id));
    const ids = [id];
    return (
        <Menu.SubmenuRoot>
            <Menu.SubmenuTrigger className="menu-item">
                <Icon icon={Flag} size={14} /> {t('flag.menu')}
                <Icon icon={ChevronRight} size={14} className="ml-auto text-text-faint" />
            </Menu.SubmenuTrigger>
            <Menu.Portal>
                <Menu.Positioner className="z-(--z-popup)" sideOffset={4} alignOffset={-4}>
                    <Menu.Popup className="menu-popup flex min-w-44 flex-col overflow-hidden">
                        <div className="min-h-0 overflow-y-auto overscroll-contain">
                            {NODE_ACCENTS.map((entry) => (
                                <ColorItem key={entry.id} ids={ids} entry={entry} picked={flag === entry.id} />
                            ))}
                        </div>
                        <Menu.Separator className={MENU_SEPARATOR} />
                        <Menu.Item className="menu-item" disabled={flag === null} onClick={() => flagAction(ids, null)}>
                            <Icon icon={FlagOff} size={14} /> {t('flag.remove')}
                        </Menu.Item>
                    </Menu.Popup>
                </Menu.Positioner>
            </Menu.Portal>
        </Menu.SubmenuRoot>
    );
}
