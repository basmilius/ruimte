import type { ReactNode } from 'react';
import clsx from 'clsx';
import { isApplePlatform } from '@/desktop/bridge';
import { TOOLTIP_KBD } from '@/ui/classes';
import { formatShortcut, shortcutParts, type Shortcut } from '@/ui/shortcut';

/* One key, drawn as a cap. Settings prints a shortcut key by key, so a gesture can stand beside it. */
const KEY_CAP = 'rounded-md border border-border bg-surface-sunken px-1.5 py-0.5 font-sans text-xs text-text-muted';

interface KbdProps {
    shortcut: Shortcut;
    /*
     * Where the shortcut is printed. In a menu row the `.menu-item kbd` rule dresses it, as the
     * quiet hint at the end of the row; anywhere else it is a chip on the surface it sits on.
     */
    variant?: 'menu' | 'inline';
    className?: string;
}

/* A shortcut as this platform prints it: `⌘K` on macOS, `Ctrl+K` elsewhere. */
export function Kbd({ shortcut, variant = 'menu', className }: KbdProps) {
    return <kbd className={clsx(variant === 'inline' && TOOLTIP_KBD, className)}>{formatShortcut(shortcut, isApplePlatform())}</kbd>;
}

export function KeyCap({ children }: { children: ReactNode }) {
    return <kbd className={KEY_CAP}>{children}</kbd>;
}

/* A shortcut as one cap per key, `⌘` and `K`, plus the pointer gesture it goes with ("drag"). */
export function Keys({ shortcut, then }: { shortcut: Shortcut; then?: string }) {
    const parts = [...shortcutParts(shortcut, isApplePlatform()), ...(then ? [then] : [])];
    return (
        <span className="flex items-center gap-1">
            {parts.map((part, index) => (
                <KeyCap key={`${part}-${index}`}>{part}</KeyCap>
            ))}
        </span>
    );
}
