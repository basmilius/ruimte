import type { Endpoint } from '@/state/endpoints';

export interface WorkspaceLinkState {
    /* A project is on screen in the workspace. */
    current: boolean;
    /* A project is being opened or swapped in. */
    switching: boolean;
    /* The machine had a project open when this client last left it, which a boot opens again. */
    remembered: boolean;
    /* The workspace's project client already tried to open that remembered project. */
    booted: boolean;
}

/*
 * Whether a workspace keeps its machine's link up: while a project is open on it, or on its way to
 * being open. A remembered project counts until the boot tried it, so a project that is gone does not
 * keep a machine connected behind an empty canvas.
 */
export const wantsLink = (state: WorkspaceLinkState): boolean => state.current || state.switching || (state.remembered && !state.booted);

/* One hold on one machine at a time, moved or dropped as what a workspace wants changes. */
export class LinkHold {
    private readonly take: (endpoint: Endpoint) => () => void;
    private heldId: string | null = null;
    private release: (() => void) | null = null;

    constructor(take: (endpoint: Endpoint) => () => void) {
        this.take = take;
    }

    get endpointId(): string | null {
        return this.heldId;
    }

    /* The machine to keep a link to, or null for none. A new hold is taken before the old one goes, so a move never closes a link both sides share. */
    set(endpoint: Endpoint | null): void {
        if ((endpoint?.id ?? null) === this.heldId) {
            return;
        }
        const before = this.release;
        this.release = endpoint ? this.take(endpoint) : null;
        this.heldId = endpoint?.id ?? null;
        before?.();
    }
}
