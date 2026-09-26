import { machineTransport } from '@/transport';

/* Files under `cwd` on one machine that fuzzy-match `query`, for the composer's mention picker. */
export const searchFiles = async (endpointId: string, cwd: string, query: string, limit: number): Promise<string[]> =>
    (await machineTransport(endpointId).request('fs.search', { cwd, query, limit })).files;
