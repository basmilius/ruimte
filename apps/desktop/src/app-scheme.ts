import { createAppScheme, type AppScheme } from '@adecore/shell';
import { DESKTOP_APP_ORIGIN, DESKTOP_APP_SCHEME, VISUAL_HOST_PAGE } from '@ruimte/contracts';
import { cspString, VISUAL_HOST_HEADERS, VISUAL_HOST_PATH } from '@ruimte/csp';

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

export function answerAppRequest(scheme: AppScheme, request: Request): Promise<Response> | Response {
    const url = new URL(request.url);
    if (scheme.originOf(request.url) === DESKTOP_APP_ORIGIN && url.pathname === STORAGE_MOVE_PATH) {
        // The storage move writes through executeJavaScript without booting the client or its policy.
        return new Response('<!doctype html><title>Ruimte</title>', { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    if (scheme.originOf(request.url) === DESKTOP_APP_ORIGIN && url.pathname === VISUAL_HOST_PATH) {
        return new Response(VISUAL_HOST_PAGE, { headers: VISUAL_HOST_HEADERS });
    }
    return scheme.handle(request);
}
