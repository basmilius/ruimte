import type { ExtensionManifest } from '@ruimte/contracts';

export interface InstalledClientExtension {
    manifest: ExtensionManifest;
    /* Where its files are served on the app's own origin, ending in a slash. A new version or dev build gets a new one. */
    base: string;
    enabled: boolean;
    hasClient: boolean;
    hasIcon?: boolean;
    dev: boolean;
}

/* The client side of what a person installed on this computer. The shell keeps the files, since a window may have no machine of its own. */
export interface ExtensionsBridge {
    list(): Promise<InstalledClientExtension[]>;
    /* The bytes of a `.rex`. Refuses a pack that does not hold together, and leaves what is installed alone. */
    install(pack: Uint8Array): Promise<InstalledClientExtension>;
    remove(id: string): Promise<void>;
    setEnabled(id: string, enabled: boolean): Promise<void>;
    /* The folder `ruimte extension dev` builds into, on this computer. A new revision is a new `base`. */
    link(folder: string, revision: number): Promise<void>;
    unlink(id: string): Promise<void>;
}
