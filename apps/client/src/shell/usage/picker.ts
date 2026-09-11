/*
 * The machine the usage page is about. A picked machine holds until it is gone from the endpoint
 * list (forgotten, unpaired), and then the page falls back to the machine its workspace runs on
 * rather than showing numbers under the name of a machine this client no longer knows.
 */
export const usageEndpointFor = (chosen: string | null, known: readonly string[], workspaceId: string): string =>
    chosen !== null && known.includes(chosen) ? chosen : workspaceId;
