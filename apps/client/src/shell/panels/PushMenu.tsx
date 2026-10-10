import { useTranslation } from 'react-i18next';
import { ArrowUp, ChevronDown } from 'lucide-react';
import type { GitActionKind } from '@ruimte/contracts';
import { pushAllButton, type PushButton, type PushEntry } from '@/shell/panels/git-actions';
import { Button, ButtonGroup, Icon, Menu, Tooltip } from '@adecore/ui';

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
 * The primary button of the header. Over more than one repository the left half pushes all of them,
 * and the chevron opens the flyout that pushes or publishes one on its own.
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
    const anyRow = entries.some((entry) => !entry.button.disabled);

    return (
        <ButtonGroup render={<span />}>
            <Tooltip label={all.reason}>
                <Button size="sm" variant="primary" className="rounded-r-none" disabled={all.disabled || busy} onClick={onPushAll}>
                    {all.label}
                </Button>
            </Tooltip>
            <Menu.Root>
                <Tooltip label={t('git.push.one')} name>
                    <Menu.Trigger render={<Button size="sm" variant="primary" className="rounded-l-none px-1.5" disabled={!anyRow || busy} />}>
                        <Icon icon={ChevronDown} size={14} />
                    </Menu.Trigger>
                </Tooltip>
                <Menu.Popup className="w-72" align="end">
                    {entries.map((entry) => (
                        <Menu.Item
                            key={entry.cwd}

                            disabled={busy || entry.button.disabled}
                            onClick={() => onPush(entry.cwd, entry.button.kind)}
                        >
                            <span className="truncate">{entry.label}</span>
                            <span className="grow" />
                            <Menu.Hint className="truncate">{entry.button.disabled ? entry.button.reason : entry.button.label}</Menu.Hint>
                            {entry.ahead > 0 && (
                                <span className="flex shrink-0 items-center text-text-faint">
                                    <Icon icon={ArrowUp} size={12} />
                                    <span className="tabular-nums">{entry.ahead}</span>
                                </span>
                            )}
                        </Menu.Item>
                    ))}
                </Menu.Popup>
            </Menu.Root>
        </ButtonGroup>
    );
}
