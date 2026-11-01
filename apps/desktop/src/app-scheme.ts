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

/*
 * Under `bun dev` a window is on Vite's origin, which has no extension files: they sit beside the shell, or
 * in a dev link only the shell knows. So those paths are answered here, and the rest goes on to Vite.
 */
export function devExtensionFiles(devUrl: string, extensions: Pick<ClientExtensions, 'answer'>, pass: (request: Request) => Promise<Response>) {
    const { origin } = new URL(devUrl);

    return (request: Request): Promise<Response> => {
        const url = new URL(request.url);

        return url.origin === origin && url.pathname.startsWith(EXTENSION_FILES_PATH) ? extensions.answer(url.pathname, origin) : pass(request);
    };
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
