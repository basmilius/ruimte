export interface NodeTitleDeps {
    titleFor(id: string): string | null;
    shows(id: string): boolean;
    /* The chat or routine that opened a hidden agent; undefined for every other id. */
    openedBy(id: string): string | undefined;
}

/*
 * The name a push gives a node. A hidden agent is answered from the first chat above it a person
 * finds in the project, so its name says which one: "<agent> in <chat>".
 */
export function pushNodeTitle(deps: NodeTitleDeps, nodeId: string): string | null {
    const title = deps.titleFor(nodeId);

    if (title === null || deps.shows(nodeId)) {
        return title;
    }

    const seen = new Set([nodeId]);
    let opener = deps.openedBy(nodeId);

    while (opener !== undefined && !seen.has(opener)) {
        if (deps.shows(opener)) {
            const openerTitle = deps.titleFor(opener);

            return openerTitle === null ? title : `${title} in ${openerTitle}`;
        }

        seen.add(opener);
        opener = deps.openedBy(opener);
    }

    return title;
}
