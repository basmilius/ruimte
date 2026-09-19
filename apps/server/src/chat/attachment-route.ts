import type { ChatAttachment } from '@ruimte/contracts';
import type { AccessOptions } from '../auth/access.ts';
import type { AuthStore } from '../auth/auth-store.ts';
import { bytesResponse, guardBytesRequest } from '../bytes/byte-route.ts';

export const ATTACHMENTS_PATH = '/attachments';

// What a browser may paint itself; anything else is handed over as a download instead.
const INLINE_MIME = /^(image\/(png|jpeg|gif|webp|svg\+xml)|application\/pdf|text\/plain)$/;

/*
 * `GET /attachments/<chatId>/<id>`: a file someone attached to a message in that chat. Behind the
 * same access rules as the socket and the project icon, so a paired client sends the token it
 * already has. The chat's own thread is what says which id belongs to which file, so nothing but
 * an attachment of a chat this daemon knows can be reached through here.
 */
export const handleAttachmentRequest = async (
    request: Request,
    url: URL,
    remoteAddress: string,
    auth: AuthStore,
    options: AccessOptions,
    lookup: (chatId: string, id: string) => ChatAttachment | null
): Promise<Response> => {
    const parts = url.pathname.slice(ATTACHMENTS_PATH.length + 1).split('/');
    if (parts.length !== 2 || parts[0] === '' || parts[1] === '') {
        return new Response('Not found', { status: 404 });
    }
    const refused = await guardBytesRequest(request, remoteAddress, auth, options);
    if (refused) {
        return refused;
    }
    const attachment = lookup(decodeURIComponent(parts[0]!), decodeURIComponent(parts[1]!));
    if (!attachment) {
        return new Response('No attachment', { status: 404 });
    }
    const bytes = Bun.file(attachment.path);
    if (!(await bytes.exists())) {
        return new Response('No attachment', { status: 404 });
    }
    return bytesResponse({ mime: attachment.mime, size: bytes.size, body: bytes }, { name: attachment.name, inline: INLINE_MIME.test(attachment.mime) });
};
