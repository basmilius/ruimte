import type { InstalledClientExtension } from '@ruimte/desktop-bridge';
import { create } from 'zustand';

export interface ExtensionsState {
    installed: readonly InstalledClientExtension[];
    // What failed to load, by id, shown on its row in Settings.
    failures: Readonly<Record<string, string>>;

    /* Whether `installed` is what this computer has, or only the empty list of before it came. */
    listed?: boolean;
}

/* Kept apart from the loader, so a list that reads it does not load the extension runtime. */
export const useInstalledExtensions = create<ExtensionsState>(() => ({ installed: [], failures: {} }));
