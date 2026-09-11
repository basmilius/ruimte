import { decideAccess, type AccessOptions } from '../auth/access.ts';
import type { AuthStore } from '../auth/auth-store.ts';
import type { ProjectStore } from './project-store.ts';

export const PROJECTS_PATH = '/projects';

// The URL carries the file's version, so the bytes behind it never change; a year is forever enough.
const CACHE_CONTROL = 'private, max-age=31536000, immutable';

// An SVG painted in an `<img>` runs nothing, but the URL can also be opened directly. This makes
// that page inert as well: no script, no network, no subresource, only the styles it carries.
const SVG_CSP = "default-src 'none'; style-src 'unsafe-inline'";

/*
 * `GET /projects/<projectId>/icon?v=<version>&theme=dark`: the image a project's folder declares.
 * Behind the same access rules as the socket, so a paired client sends the token it already has.
 */
export const handleProjectRequest = async (
    request: Request,
    url: URL,
    remoteAddress: string,
    auth: AuthStore,
    options: AccessOptions,
    projects: ProjectStore
): Promise<Response> => {
    const parts = url.pathname.slice(PROJECTS_PATH.length + 1).split('/');
    if (parts.length !== 2 || parts[1] !== 'icon' || parts[0] === '') {
        return new Response('Not found', { status: 404 });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('Method not allowed', { status: 405 });
    }
    const decision = await decideAccess(request, remoteAddress, auth, options);
    if (!decision.ok) {
        return new Response(decision.reason, { status: decision.status });
    }
    const theme = url.searchParams.get('theme') === 'dark' ? 'dark' : 'light';
    const file = await projects.iconFile(decodeURIComponent(parts[0]!), theme);
    if (!file) {
        return new Response('No icon', { status: 404 });
    }
    const bytes = Bun.file(file.path);
    if (!(await bytes.exists())) {
        return new Response('No icon', { status: 404 });
    }
    const headers: Record<string, string> = {
        'content-type': file.mime,
        'content-disposition': 'inline',
        'cache-control': CACHE_CONTROL,
        'x-content-type-options': 'nosniff'
    };
    if (file.mime === 'image/svg+xml') {
        headers['content-security-policy'] = SVG_CSP;
    }
    return new Response(bytes, { headers });
};
