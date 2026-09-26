import { Menu } from '@base-ui-components/react/menu';
import { Check } from 'lucide-react';
import { Icon } from './Icon.tsx';

interface MenuCheckProps {
    /* One of several is a bare tick; on or off is a tick in an outlined box, which says the row can be off. */
    kind: 'radio' | 'checkbox';
    /* Only for a row that is not a Base UI radio or checkbox item, and so has no indicator of its own. */
    checked?: boolean;
}

/*
 * The slot before the label of a row that can be checked, in a menu or a list that reads as one. It
 * is one line of the row tall, so a row with a second line keeps the tick beside its first.
 */
export function MenuCheck({ kind, checked }: MenuCheckProps) {
    const tick = <Icon icon={Check} size={kind === 'radio' ? 14 : 12} />;
    const indicator =
        checked !== undefined ? (
            checked && tick
        ) : kind === 'radio' ? (
            <Menu.RadioItemIndicator className="flex">{tick}</Menu.RadioItemIndicator>
        ) : (
            <Menu.CheckboxItemIndicator className="flex">{tick}</Menu.CheckboxItemIndicator>
        );
    return (
        <span className="grid h-lh w-4 shrink-0 place-items-center">
            {kind === 'checkbox' ? <span className="grid h-4 w-4 place-items-center rounded border border-border-strong">{indicator}</span> : indicator}
        </span>
    );
}
