/*
 * A view of a project stands in one window at a time. The grid asks here before it puts a view in a
 * cell, and `view-windows` answers, so the grid imports nothing of the windows.
 */
export interface ViewHomes {
    elsewhere(viewId: string): boolean;

    /* A person asked here for a view another window has, so that window comes to the front with it. */
    reach(viewId: string): void;
}

const ALL_HERE: ViewHomes = { elsewhere: () => false, reach: () => undefined };

let homes = ALL_HERE;

/* Null is a page without other windows, where every view is its own. */
export function provideViewHomes(next: ViewHomes | null): void {
    homes = next ?? ALL_HERE;
}

export function isElsewhere(viewId: string): boolean {
    return homes.elsewhere(viewId);
}

export function reachElsewhere(viewId: string): void {
    homes.reach(viewId);
}
