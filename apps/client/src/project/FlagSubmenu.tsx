import { useTranslation } from 'react-i18next';
import { Menu } from '@base-ui-components/react/menu';
import { Check, ChevronRight, Ellipsis, FlagOff, Flag } from 'lucide-react';
import { flagOf, type NodeAccent } from '@ruimte/contracts';
import { flagAction } from '@/actions/client-actions';
import { accentColor, accentLabel, FEATURED_ACCENTS, isFeatured, NODE_ACCENTS } from '@/canvas/accents';
import { useDocument } from '@/state/document';
import { MENU_SEPARATOR } from '@/ui/classes';
import { Icon } from '@/ui/Icon';

const FEATURED = NODE_ACCENTS.filter((entry) => isFeatured(entry.id)).sort((a, b) => FEATURED_ACCENTS.indexOf(a.id) - FEATURED_ACCENTS.indexOf(b.id));

const REST = NODE_ACCENTS.filter((entry) => !isFeatured(entry.id));

function ColorItem({ ids, entry, picked }: { ids: readonly string[]; entry: (typeof NODE_ACCENTS)[number]; picked: boolean }) {
    return (
        <Menu.Item className="menu-item" onClick={() => flagAction(ids, entry.id)}>
            <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: entry.color }} aria-hidden />
            <span className="grow">{accentLabel(entry.id)}</span>
            {picked && <Icon icon={Check} size={14} className="shrink-0" />}
        </Menu.Item>
    );
}

/*
 * "Flag" in the menu of a view and of a node. The colors are the node accents, the featured ones in
 * the open and the rest one level in, the way the accent setting offers them; the trigger of that
 * level wears the color when it is one it hides.
 */
export function FlagSubmenu({ id }: { id: string }) {
    const { t } = useTranslation('project');
    const flag = useDocument((state) => flagOf(state.flags, id));
    const ids = [id];
    const hidden: NodeAccent | null = flag !== null && !isFeatured(flag) ? flag : null;
    return (
        <Menu.SubmenuRoot>
            <Menu.SubmenuTrigger className="menu-item">
                <Icon icon={Flag} size={14} /> {t('flag.menu')}
                <Icon icon={ChevronRight} size={14} className="ml-auto text-text-faint" />
            </Menu.SubmenuTrigger>
            <Menu.Portal>
                <Menu.Positioner className="z-(--z-popup)" sideOffset={4} alignOffset={-4}>
                    <Menu.Popup className="menu-popup min-w-44">
                        {FEATURED.map((entry) => (
                            <ColorItem key={entry.id} ids={ids} entry={entry} picked={flag === entry.id} />
                        ))}
                        <Menu.SubmenuRoot>
                            <Menu.SubmenuTrigger className="menu-item">
                                {hidden === null ? (
                                    <Icon icon={Ellipsis} size={14} className="shrink-0 text-text-muted" />
                                ) : (
                                    <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: accentColor(hidden) }} aria-hidden />
                                )}
                                <span className="grow">{hidden === null ? t('flag.more') : accentLabel(hidden)}</span>
                                <Icon icon={ChevronRight} size={14} className="text-text-faint" />
                            </Menu.SubmenuTrigger>
                            <Menu.Portal>
                                <Menu.Positioner className="z-(--z-popup)" sideOffset={4} alignOffset={-4}>
                                    <Menu.Popup className="menu-popup max-h-96 min-w-44 overflow-y-auto">
                                        {REST.map((entry) => (
                                            <ColorItem key={entry.id} ids={ids} entry={entry} picked={flag === entry.id} />
                                        ))}
                                    </Menu.Popup>
                                </Menu.Positioner>
                            </Menu.Portal>
                        </Menu.SubmenuRoot>
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
