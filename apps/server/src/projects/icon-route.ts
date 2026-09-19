import type { AccessOptions } from '../auth/access.ts';
import type { AuthStore } from '../auth/auth-store.ts';
import { bytesResponse, guardBytesRequest } from '../bytes/byte-route.ts';
import type { ProjectStore } from './project-store.ts';

export const PROJECTS_PATH = '/projects';

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
    const refused = await guardBytesRequest(request, remoteAddress, auth, options);
    if (refused) {
        return refused;
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
    return bytesResponse({ mime: file.mime, size: bytes.size, body: bytes }, { inline: true });
};
