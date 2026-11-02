'use client';

import { useSyncExternalStore } from 'react';
import { KeyCap, isApplePlatform, shortcut, shortcutParts } from '@adecore/ui';

function subscribe() {
    return () => {};
}

/**
 * A shortcut as caps, written the way the reader's computer writes it. The page is prerendered without
 * a platform, so it starts as Ctrl and turns into ⌘ on a Mac once it hydrates. `Keys` reads the platform
 * while it renders, which would make the two disagree.
 */
export function Shortcut({ keys }: { readonly keys: string }) {
    const apple = useSyncExternalStore(subscribe, isApplePlatform, () => false);

    return (
        <span className="inline-flex -translate-y-px items-center gap-0.5 align-middle">
            {shortcutParts(shortcut(keys), apple).map((part) => (
                <KeyCap key={part} size="sm">
                    {part}
                </KeyCap>
            ))}
        </span>
    );
}
