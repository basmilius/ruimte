/*
 * The page's find marks, drawn with the CSS Custom Highlight API so the DOM a row or a document renders
 * never changes under a search. The page has one registry for every name, and two bars can be open at
 * once (a chat and a file side by side), so each owner hands its ranges in here and the two names are
 * drawn from all of them. `::highlight(find-match)` and `::highlight(find-current)` in `styles.css`.
 */
const owners = new Map<string, { matches: Range[]; current: Range | null }>();

const supported = (): boolean => typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined';

const paint = (): void => {
    if (!supported()) {
        return;
    }
    const matches: Range[] = [];
    const current: Range[] = [];
    for (const owner of owners.values()) {
        matches.push(...owner.matches);
        if (owner.current !== null) {
            current.push(owner.current);
        }
    }
    CSS.highlights.set('find-match', new Highlight(...matches));
    CSS.highlights.set('find-current', new Highlight(...current));
};

export const setFindHighlights = (owner: string, matches: Range[], current: Range | null): void => {
    owners.set(owner, { matches, current });
    paint();
};

export const clearFindHighlights = (owner: string): void => {
    if (owners.delete(owner)) {
        paint();
    }
};
