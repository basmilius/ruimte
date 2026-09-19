/* Where updating stands, as the shell keeps it and the client draws it. */
export interface UpdateState {
    /* `unsupported` is a checkout, which has no feed; `current` means a check found nothing newer. */
    status: 'unsupported' | 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'ready' | 'error';
    currentVersion: string;
    /* The version on the other side, once a check has seen one. */
    version?: string;
    percent?: number;
    error?: string | null;
}

/* What the agents of one window add up to. The client counts it; the shell badges the dock and asks before quitting. */
export interface AgentActivity {
    /* Agents in the middle of a turn. What the quit dialog names, and never an attached shell. */
    working: number;
    /* Nodes waiting to be looked at: the ones that need you plus the ones that finished out of sight. */
    attention: number;
}

/* One published release. */
export interface Release {
    /* Without the `v` of the tag. */
    version: string;
    publishedAt: string;
    /* Markdown, with the closing Full Changelog line taken off. Empty when the release has no notes. */
    body: string;
    url: string;
    compareUrl: string | null;
}

export interface ReleaseNotesState {
    releases: Release[];
    /* When GitHub last answered, whether with a list or with "nothing changed". Null before the first answer. */
    fetchedAt: string | null;
    /* Why the last fetch failed. The releases of the fetch before it stay. */
    error: string | null;
}
