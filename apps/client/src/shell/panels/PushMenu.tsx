import { Icon, Menu, SplitButton } from '@adecore/ui';
import { formatNumber } from '@adecore/ui/format';
import type { GitActionKind } from '@ruimte/contracts';
import { ArrowUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { pushAllButton, pushable, type PushButton, type PushEntry } from '@/shell/panels/git-actions';

interface PushMenuProps {
    /* What a folder with a single repository pushes; with more than one the button pushes them all. */
    button: PushButton;
    /* The checkout that single button belongs to; null while no repository is read yet. */
    active: string | null;
    /* Every repository the panel draws. */
    entries: readonly PushEntry[];
    busy: boolean;
    onPush(cwd: string, kind: GitActionKind): void;
    onPushAll(): void;
}

/*
 * The split button in the header: the left half says how many commits go out and pushes them, over
 * every repository at once when there are several, and the chevron opens the flyout that pushes or
 * publishes one on its own. A branch without an upstream is published, which the left half then says.
 */
export function PushMenu({ button, active, entries, busy, onPush, onPushAll }: PushMenuProps) {
    const { t } = useTranslation('panels');
    const one = entries.length <= 1;
    const main = one ? button : pushAllButton(entries);
    const ahead = (one ? entries : pushable(entries)).reduce((count, entry) => count + entry.ahead, 0);
    const anyRow = entries.some((entry) => !entry.button.disabled);
    const nothing = main.disabled || (one && active === null);

    return (
        <SplitButton
            size="xs"
            /* Only standing out while there is something to send; an idle button stays out of the way.
               A push under way keeps it as it was, so it does not flicker. */
            variant={nothing ? 'ghost' : 'primary'}
            className="tabular-nums"
            tooltip={main.reason}
            aria-label={main.label}
            disabled={nothing || busy}
            onClick={() => {
                if (!one) {
                    onPushAll();
                } else if (active !== null) {
                    onPush(active, button.kind);
                }
            }}
            menuLabel={t('git.push.one')}
            menuDisabled={!anyRow || busy}
            menuClassName="w-72"
            menu={entries.map((entry) => (
                <Menu.Item key={entry.cwd} disabled={busy || entry.button.disabled} onClick={() => onPush(entry.cwd, entry.button.kind)}>
                    <span className="truncate">{entry.label}</span>
                    <span className="grow" />
                    <Menu.Hint className="truncate">{entry.button.disabled ? entry.button.reason : entry.button.label}</Menu.Hint>
                    {entry.ahead > 0 && (
                        <span className="flex shrink-0 items-center text-text-faint">
                            <Icon icon={ArrowUp} size={12} />
                            <span className="tabular-nums">{formatNumber(entry.ahead)}</span>
                        </span>
                    )}
                </Menu.Item>
            ))}
        >
            {main.kind === 'publish' ? (
                main.label
            ) : (
                <>
                    <Icon icon={ArrowUp} size={12} />
                    {formatNumber(ahead)}
                </>
            )}
        </SplitButton>
    );
}
