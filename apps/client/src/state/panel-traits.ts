/* How the project's file keeps the panel that was open: beside `panel`, in a key an older client ignores. */
type StoredPanelFlag = 'launchesPanel' | 'databasesPanel' | 'outputPanel';

interface PanelTraits {
    /* The Chats project has no place for it: its folder is the daemon's, and so are its repository and what runs in it. */
    readonly hiddenInScratch?: true;
    /* Open only for this session: the file stores it as closed, since what it shows does not outlive the window. */
    readonly sessionOnly?: true;
    /* A kind the file does not know: it is stored as the files panel plus this key. */
    readonly storedAs?: StoredPanelFlag;
}

/*
 * What the project's file and the Chats project need of a panel kind. A fixed table rather than the panel
 * registry, which the workspace's chunk fills: the panels are read from the file as `project.open` answers,
 * which may come first.
 */
const PANEL_TRAITS: Readonly<Record<string, PanelTraits>> = {
    files: { hiddenInScratch: true },
    git: { hiddenInScratch: true },
    devices: { hiddenInScratch: true },
    launches: { hiddenInScratch: true, storedAs: 'launchesPanel' },
    databases: { hiddenInScratch: true, storedAs: 'databasesPanel' },
    output: { storedAs: 'outputPanel' },
    problems: { hiddenInScratch: true, sessionOnly: true },
    voice: { sessionOnly: true }
};

export function panelTraits(kind: string): PanelTraits {
    return Object.hasOwn(PANEL_TRAITS, kind) ? PANEL_TRAITS[kind]! : {};
}

/* The kind a stored flag stands for, or null when the file sets none. */
export function kindOfStoredFlag(stored: Partial<Record<StoredPanelFlag, boolean>>): string | null {
    return Object.entries(PANEL_TRAITS).find(([, traits]) => traits.storedAs !== undefined && stored[traits.storedAs] === true)?.[0] ?? null;
}
