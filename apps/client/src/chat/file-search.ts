import { machineTransport } from '@/transport';

export async function searchFiles(endpointId: string, cwd: string, query: string, limit: number): Promise<string[]> {
    return (await machineTransport(endpointId).request('fs.search', { cwd, query, limit })).files;
}
