import { useTranslation } from 'react-i18next';
import { Menu } from '@base-ui-components/react/menu';
import { ArrowUp, ChevronDown } from 'lucide-react';
import type { GitActionKind } from '@ruimte/contracts';
import { pushAllButton, type PushButton, type PushEntry } from '@/shell/panels/git-actions';
import { Button } from '@/ui/Button';
import { BTN_GROUP, MENU_HINT } from '@/ui/classes';
import { Icon } from '@/ui/Icon';
import { MenuPopup } from '@/ui/MenuPopup';
import { Tooltip } from '@/ui/Tooltip';

interface PushMenuProps {
    /* What a folder with a single repository pushes; with more than one the button pushes them all. */
    button: PushButton;
    /* The checkout that single button belongs to; null while no repository is read yet. */
    active: string | null;
    /* Every repository the panel draws; one of them means no menu at all. */
    entries: readonly PushEntry[];
    busy: boolean;
    onPush(cwd: string, kind: GitActionKind): void;
    onPushAll(): void;
}

/*
 * The primary button of the header. A folder with one repository has exactly the button it always
 * had. With more than one it grows a second half: the left one pushes every repository that has
 * something to push, and the chevron opens the flyout that pushes one of them on its own.
 */
export function PushMenu({ button, active, entries, busy, onPush, onPushAll }: PushMenuProps) {
    const { t } = useTranslation('panels');

    if (entries.length <= 1) {
        return (
            <Tooltip label={button.reason}>
                <Button
                    size="sm"
                    variant="primary"
                    disabled={button.disabled || busy || active === null}
                    onClick={() => active !== null && onPush(active, button.kind)}
                >
                    {button.label}
                </Button>
            </Tooltip>
        );
    }

    const all = pushAllButton(entries);

    return (
        <span className={BTN_GROUP}>
            <Tooltip label={all.reason}>
                <Button size="sm" variant="primary" className="rounded-r-none" disabled={all.disabled || busy} onClick={onPushAll}>
                    {all.label}
                </Button>
            </Tooltip>
            <Menu.Root>
                <Tooltip label={t('git.push.one')} name>
                    <Menu.Trigger render={<Button size="sm" variant="primary" className="rounded-l-none px-1.5" disabled={all.disabled || busy} />}>
                        <Icon icon={ChevronDown} size={14} />
                    </Menu.Trigger>
                </Tooltip>
                <MenuPopup className="w-72" align="end">
                    {entries.map((entry) => (
                        <Menu.Item
                            key={entry.cwd}
                            className="menu-item"
                            disabled={busy || entry.button.disabled}
                            onClick={() => onPush(entry.cwd, entry.button.kind)}
                        >
                            <span className="truncate">{entry.label}</span>
                            <span className="grow" />
                            <span className={`${MENU_HINT} truncate`}>{entry.button.disabled ? entry.button.reason : entry.button.label}</span>
                            {entry.ahead > 0 && (
                                <span className="flex shrink-0 items-center text-text-faint">
                                    <Icon icon={ArrowUp} size={12} />
                                    <span className="tabular-nums">{entry.ahead}</span>
                                </span>
                            )}
                        </Menu.Item>
                    ))}
                </MenuPopup>
            </Menu.Root>
        </span>
    );
}
