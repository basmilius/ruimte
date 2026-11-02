/*
 * Which nodes `context.read` of an extension reads, one rule for the machine and the test host: each node it names and
 * every node of the view it names, once. Naming neither reads nothing.
 */
export function contextSelection(of: { nodeIds?: readonly string[] | undefined; viewId?: string | undefined }): (nodeId: string, viewId: string) => boolean {
    const named = new Set(of.nodeIds ?? []);

    return (nodeId, viewId) => viewId === of.viewId || named.has(nodeId);
}
