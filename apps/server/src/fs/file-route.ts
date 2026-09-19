import type { AccessOptions } from '../auth/access.ts';
import type { AuthStore } from '../auth/auth-store.ts';
import { bytesResponse, guardBytesRequest, parseByteRange } from '../bytes/byte-route.ts';
import { readMedia } from './read.ts';

export const FS_FILE_PATH = '/fs/file';

/*
 * Serve only authenticated image and video bytes; other readable files stay on the socket. Video
 * supports ranges so media elements can seek.
 */
export const handleFsFileRequest = async (request: Request, url: URL, remoteAddress: string, auth: AuthStore, options: AccessOptions): Promise<Response> => {
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
    const media = await readMedia(path).catch(() => null);
    if (!media) {
        return new Response('Not a file this route serves', { status: 404 });
    }
    const range = parseByteRange(request.headers.get('range'), media.size);
    return bytesResponse({ mime: media.mime, size: media.size, body: media.bytes }, { inline: true, range });
};
