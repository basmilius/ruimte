import type { AccessOptions } from '../auth/access.ts';
import type { AuthStore } from '../auth/auth-store.ts';
import { bytesResponse, guardBytesRequest, parseByteRange } from '../bytes/byte-route.ts';
import { MachineHomeError, type MachineHome } from './machine-home.ts';
import { readServedFile } from './read.ts';

export const FS_FILE_PATH = '/fs/file';

/*
 * Serve only authenticated image, video, sound, PDF and text bytes. Text comes here when it is past
 * what one frame on the socket carries. Ranges let a media element seek and a PDF reader fetch one page at a time.
 */
export const handleFsFileRequest = async (
    request: Request,
    url: URL,
    remoteAddress: string,
    auth: AuthStore,
    options: AccessOptions,
    machineHome: MachineHome
): Promise<Response> => {
    if (url.pathname !== FS_FILE_PATH) {
        return new Response('Not found', { status: 404 });
    }
    const refused = await guardBytesRequest(request, remoteAddress, auth, options);
    if (refused) {
        return refused;
    }
    const path = url.searchParams.get('path');
    if (!path) {
        return new Response('No path', { status: 400 });
    }
    const refusal = await machineHome.refuse(path).catch((e: unknown) => {
        if (e instanceof MachineHomeError) {
            return e;
        }
        throw e;
    });
    if (refusal) {
        return new Response(refusal.message, { status: 403 });
    }
    const served = await readServedFile(path).catch(() => null);
    if (!served) {
        return new Response('Not a file this route serves', { status: 404 });
    }
    const range = parseByteRange(request.headers.get('range'), served.size);
    return bytesResponse({ mime: served.mime, size: served.size, body: served.bytes }, { inline: true, range });
};
