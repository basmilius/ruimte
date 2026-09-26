import clsx from 'clsx';
import { accountColor } from './accounts';

/* The color an account wears, or the app's accent while it wears none of the accents. */
export function AccountDot({ color, className }: { color: string | undefined; className?: string }) {
    const paint = accountColor(color);
    return (
        <span
            aria-hidden
            className={clsx('shrink-0 rounded-full', paint === undefined && 'bg-accent', className ?? 'size-2')}
            style={paint === undefined ? undefined : { background: paint }}
        />
    );
}
