import type { ExtensionManifest } from '@ruimte/contracts';

export interface InstalledClientExtension {
    manifest: ExtensionManifest;
    /* Where its files are served on the app's own origin, ending in a slash. A new version or dev build gets a new one. */
    base: string;
    enabled: boolean;
    hasClient: boolean;
    hasIcon?: boolean;
    dev: boolean;
    /* Installed from the store; any other pack came from a file. Absent from a shell of before. */
    fromStore?: boolean;
}

/* The client side of what a person installed on this computer. The shell keeps the files, since a window may have no machine of its own. */
export interface ExtensionsBridge {
    list(): Promise<InstalledClientExtension[]>;
    /* The bytes of a `.rex`. Refuses a pack that does not hold together, and leaves what is installed alone. */
    install(pack: Uint8Array, options?: { fromStore?: boolean }): Promise<InstalledClientExtension>;
    remove(id: string): Promise<void>;
    setEnabled(id: string, enabled: boolean): Promise<void>;
    /*
     * The folder `ruimte extension dev` builds into, on this computer. A new revision is a new `base`. `enabled` is on or
     * off as the machine keeps it, in the same change; left out, a link keeps what it had, or is on.
     */
    link(folder: string, revision: number, enabled?: boolean): Promise<void>;
    unlink(id: string): Promise<void>;

    /* After any window installed, removed, turned on or off, linked or unlinked one, so every window loads what is there now. */
    onChanged?(listener: () => void): () => void;
}
