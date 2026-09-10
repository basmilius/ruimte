import type { ChatAttachment } from '@ruimte/contracts';
import { decideAccess } from '../auth/access.ts';
import type { AuthStore } from '../auth/auth-store.ts';

export const ATTACHMENTS_PATH = '/attachments';

// The id names one set of bytes that never change, so the browser may keep them for good.
const CACHE_CONTROL = 'private, max-age=31536000, immutable';

// An SVG painted in an `<img>` runs nothing, but the URL can also be opened directly. This makes
// that page inert as well: no script, no network, no subresource, only the styles it carries.
const SVG_CSP = "default-src 'none'; style-src 'unsafe-inline'";

// What a browser may paint itself; anything else is handed over as a download instead.
const INLINE_MIME = /^(image\/(png|jpeg|gif|webp|svg\+xml)|application\/pdf|text\/plain)$/;

interface AttachmentRouteOptions {
    allowedOrigins: string[];
    requireToken: boolean;
}

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
    options: AttachmentRouteOptions,
    lookup: (chatId: string, id: string) => ChatAttachment | null
): Promise<Response> => {
    const parts = url.pathname.slice(ATTACHMENTS_PATH.length + 1).split('/');
    if (parts.length !== 2 || parts[0] === '' || parts[1] === '') {
        return new Response('Not found', { status: 404 });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('Method not allowed', { status: 405 });
    }
    const decision = await decideAccess(request, remoteAddress, auth, options);
    if (!decision.ok) {
        return new Response(decision.reason, { status: decision.status });
    }
    const attachment = lookup(decodeURIComponent(parts[0]!), decodeURIComponent(parts[1]!));
    if (!attachment) {
        return new Response('No attachment', { status: 404 });
    }
    const bytes = Bun.file(attachment.path);
    if (!(await bytes.exists())) {
        return new Response('No attachment', { status: 404 });
    }
    const inline = INLINE_MIME.test(attachment.mime);
    const headers: Record<string, string> = {
        'content-type': attachment.mime,
        'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${attachment.name.replaceAll(/["\\\r\n]/g, '')}"`,
        'cache-control': CACHE_CONTROL,
        'x-content-type-options': 'nosniff'
    };
    if (attachment.mime === 'image/svg+xml') {
        headers['content-security-policy'] = SVG_CSP;
    }
    return new Response(bytes, { headers });
};
