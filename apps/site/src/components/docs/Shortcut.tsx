'use client';

import { isApplePlatform, KeyCap, shortcut, shortcutParts } from '@adecore/ui';
import { useSyncExternalStore } from 'react';

function subscribe(): () => void {
    return () => undefined;
}

/**
 * A shortcut as ADE CORE's `Keys` draws it, in the keys of the reader's own keyboard. `Keys` reads the
 * platform while it renders, which a prerendered page cannot: this one starts as Ctrl and turns into ⌘ on
 * a Mac once it hydrates. `keys` is written as the app writes it, `Mod+Shift+K`, with `Mod` for Cmd or Ctrl.
 */
export function Shortcut({ keys }: { readonly keys: string }) {
    const apple = useSyncExternalStore(subscribe, isApplePlatform, () => false);

    return (
        <span className="inline-flex items-center gap-1 align-middle whitespace-nowrap">
            {shortcutParts(shortcut(keys), apple).map((part, index) => (
                <KeyCap key={`${part}-${index}`}>{part}</KeyCap>
            ))}
        </span>
    );
}
