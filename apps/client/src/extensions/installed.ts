import { extensionProvenanceOf, type ExtensionInfo, type ExtensionProvenance } from '@ruimte/contracts';
import type { InstalledClientExtension } from '@ruimte/desktop-bridge';
import { create } from 'zustand';

export interface ExtensionsState {
    installed: readonly InstalledClientExtension[];
    // What failed to load, by id, shown on its row in Settings.
    failures: Readonly<Record<string, string>>;

    /* Whether `installed` is what this computer has, or only the empty list of before it came. */
    listed?: boolean;

    /* Where the machine says each came from, by id. Absent until a machine that tells it answered. */
    provenance?: Readonly<Record<string, ExtensionProvenance>>;
}

export function provenanceOf(listed: readonly ExtensionInfo[]): Record<string, ExtensionProvenance> {
    return Object.fromEntries(
        listed.flatMap((info) => {
            const provenance = extensionProvenanceOf(info.provenance);

            return provenance === undefined ? [] : [[info.manifest.id, provenance]];
        })
    );
}

/* Kept apart from the loader, so a list that reads it does not load the extension runtime. */
export const useInstalledExtensions = create<ExtensionsState>(() => ({ installed: [], failures: {} }));
