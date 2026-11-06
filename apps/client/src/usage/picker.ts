/*
 * The machine the usage page is about. A picked machine holds until it is gone from the endpoint list,
 * and then the page falls back to the machine its workspace runs on.
 */
export function usageEndpointFor(chosen: string | null, known: readonly string[], workspaceId: string): string {
    return chosen !== null && known.includes(chosen) ? chosen : workspaceId;
}
