import { machineTransport } from '@/transport';

/* Files under `cwd` on one machine that fuzzy-match `query`, for the composer's mention picker. */
export async function searchFiles(endpointId: string, cwd: string, query: string, limit: number): Promise<string[]> {
    return (await machineTransport(endpointId).request('fs.search', { cwd, query, limit })).files;
}
