import { createAppScheme, type AppScheme } from '@adecore/shell';
import type { ClientExtensions } from './main/extensions';
import { DESKTOP_APP_ORIGIN, DESKTOP_APP_SCHEME, VISUAL_HOST_PAGE } from '@ruimte/contracts';
import { cspString, EXTENSION_FILES_PATH, VISUAL_HOST_HEADERS, VISUAL_HOST_PATH } from '@ruimte/csp';

export const STORAGE_MOVE_PATH = '/__ruimte-storage';

export function createDesktopAppScheme(root: string, pageUrl?: string): AppScheme {
    return createAppScheme({
        scheme: DESKTOP_APP_SCHEME,
        host: new URL(DESKTOP_APP_ORIGIN).host,
        root,
        headers: { 'content-security-policy': cspString() },
        pageUrl
    });
}

/* The page the storage move writes through with executeJavaScript, without booting the client or its policy. */
export function storageMovePage(): Response {
    return new Response('<!doctype html><title>Ruimte</title>', { headers: { 'content-type': 'text/html; charset=utf-8' } });
}

export function answerAppRequest(scheme: AppScheme, request: Request, extensions?: Pick<ClientExtensions, 'answer'>): Promise<Response> | Response {
    if (scheme.originOf(request.url) === DESKTOP_APP_ORIGIN) {
        const { pathname } = new URL(request.url);
        if (pathname === STORAGE_MOVE_PATH) {
            return storageMovePage();
        }
        if (extensions !== undefined && pathname.startsWith(EXTENSION_FILES_PATH)) {
            return extensions.answer(pathname, DESKTOP_APP_ORIGIN);
        }
        if (pathname === VISUAL_HOST_PATH) {
            return new Response(VISUAL_HOST_PAGE, { headers: VISUAL_HOST_HEADERS });
        }
    }
    return scheme.handle(request);
}
