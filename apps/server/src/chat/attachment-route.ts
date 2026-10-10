import type { ChatAttachment } from '@ruimte/contracts';
import type { AccessOptions } from '../auth/access.ts';
import { bytesResponse, guardBytesRequest } from '../bytes/byte-route.ts';

export const ATTACHMENTS_PATH = '/attachments';

/*
 * What a browser may paint itself; anything else is handed over as a download instead. Never
 * text/html: a visual's page runs scripts, and on this origin they would reach the daemon's API.
 */
const INLINE_MIME = /^(image\/(png|jpeg|gif|webp|svg\+xml)|application\/pdf|text\/plain)$/;

/*
 * `GET /attachments/<chatId>/<id>`, behind the same access rules as the socket. The chat's own thread
 * maps an id to its file, so nothing but an attachment of a chat this daemon knows is reachable here.
 */
export async function handleAttachmentRequest(
    request: Request,
    url: URL,
    remoteAddress: string,
    options: AccessOptions,
    lookup: (chatId: string, id: string) => Promise<ChatAttachment | null>
): Promise<Response> {
    const parts = url.pathname.slice(ATTACHMENTS_PATH.length + 1).split('/');
    if (parts.length !== 2 || parts[0] === '' || parts[1] === '') {
        return new Response('Not found', { status: 404 });
    }
    const refused = await guardBytesRequest(request, remoteAddress, options);
    if (refused) {
        return refused;
    }
    const attachment = await lookup(decodeURIComponent(parts[0]!), decodeURIComponent(parts[1]!));
    if (!attachment) {
        return new Response('No attachment', { status: 404 });
    }
    const bytes = Bun.file(attachment.path);
    if (!(await bytes.exists())) {
        return new Response('No attachment', { status: 404 });
    }
    return bytesResponse({ mime: attachment.mime, size: bytes.size, body: bytes }, { name: attachment.name, inline: INLINE_MIME.test(attachment.mime) });
}
