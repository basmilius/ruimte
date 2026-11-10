import { createAppScheme, type AppScheme } from '@adecore/shell';
import { DESKTOP_APP_ORIGIN, DESKTOP_APP_SCHEME } from '@ruimte/contracts';
import { cspString, EXTENSION_FILES_PATH } from '@ruimte/csp';
import { VISUAL_HOST, visualHostResponse } from '@ruimte/csp/visual-host';
import type { ClientExtensions } from './main/extensions';

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
        if (pathname === VISUAL_HOST.path) {
            return visualHostResponse();
        }
    }
    return scheme.handle(request);
}
