'use client';

import { useSyncExternalStore } from 'react';
import { isApplePlatform, KeyCap, shortcut, shortcutParts } from '@adecore/ui';

const subscribe = (): (() => void) => () => undefined;

/*
 * A shortcut in the keys of the reader's own keyboard: ⌘ on a Mac, Ctrl elsewhere. The page is built
 * ahead of time without a platform, so it first prints the other one and swaps once it is running.
 * `keys` is written as the app writes it, `Mod+Shift+K`, with `Mod` for Cmd or Ctrl.
 */
export function Shortcut({ keys }: { readonly keys: string }) {
    const apple = useSyncExternalStore(subscribe, isApplePlatform, () => false);

    return (
        <span className="inline-flex items-center gap-0.5 align-middle whitespace-nowrap">
            {shortcutParts(shortcut(keys), apple).map((part, index) => (
                <KeyCap key={`${part}-${index}`} size="sm">
                    {part}
                </KeyCap>
            ))}
        </span>
    );
}
