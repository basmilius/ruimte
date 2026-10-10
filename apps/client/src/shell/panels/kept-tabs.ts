/* How many tabs keep their editor while another is up, the most recently shown first. */
export const KEPT_TABS = 8;

/* The tabs shown last, the one shown now first, after `active` came up. */
export function shownAfter(previous: readonly string[], active: string, limit = KEPT_TABS): string[] {
    return [active, ...previous.filter((key) => key !== active)].slice(0, limit);
}

/*
 * The tabs to keep drawn: the one up and those shown before it that are still open, at most `limit`, plus
 * every tab `holds` says would lose something unmounted. Ordered by key, which no switch changes, since an
 * element moved in the page loses its scroll position.
 */
export function keptTabs<T extends { key: string }>(
    active: string | null,
    shown: readonly string[],
    tabs: readonly T[],
    limit = KEPT_TABS,
    holds: (tab: T) => boolean = () => false
): T[] {
    const recent = (active === null ? shown : shownAfter(shown, active, Number.POSITIVE_INFINITY))
        .flatMap((key) => tabs.filter((tab) => tab.key === key))
        .slice(0, limit);
    const held = tabs.filter((tab) => holds(tab) && !recent.includes(tab));
    return [...recent, ...held].sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0));
}
