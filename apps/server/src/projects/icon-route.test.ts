import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuthStore } from '../auth/auth-store.ts';
import { handleProjectRequest, PROJECTS_PATH } from './icon-route.ts';
import { ProjectStore } from './project-store.ts';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');

// No handshake in these tests, so a credential is only ever a session token.
// What the desktop app on this machine presents; a loopback address alone gets nothing.
const LOCAL_SECRET = 'the-local-secret';
const OPTIONS = { allowedOrigins: [], localSecret: LOCAL_SECRET, tickets: { ticketAccess: async () => null } };

let root: string;
let folder: string;
let store: ProjectStore;
let auth: AuthStore;
let projectId: string;

const ask = (path: string, remote = '127.0.0.1', init?: RequestInit): Promise<Response> => {
    const url = new URL(`http://127.0.0.1:4210${path}`);
    return handleProjectRequest(new Request(url, asLocal(init)), url, remote, auth, OPTIONS, store);
};
// Every request below carries the local secret unless a test says otherwise, the way the desktop app's does.
const asLocal = (init?: RequestInit): RequestInit => ({
    ...init,
    headers: { authorization: `Bearer ${LOCAL_SECRET}`, ...(init?.headers as Record<string, string>) }
});

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-icon-route-'));
    folder = join(root, 'repo');
    await mkdir(join(folder, '.ruimte'), { recursive: true });
    await writeFile(join(folder, '.ruimte', 'icon.png'), PNG);
    store = new ProjectStore(join(root, 'home'));
    auth = new AuthStore(join(root, 'home'));
    projectId = (await store.openProject({ folder })).summary.projectId;
});

afterEach(async () => {
    store.closeAll();
    await rm(root, { recursive: true, force: true });
});

describe('the icon route', () => {
    test('a loopback address without a credential gets nothing', async () => {
        const url = new URL(`http://127.0.0.1:4210${PROJECTS_PATH}/${projectId}/icon?v=1`);
        expect((await handleProjectRequest(new Request(url), url, '127.0.0.1', auth, OPTIONS, store)).status).toBe(401);
    });

    test('serves the bytes to the local secret with headers that keep them inert', async () => {
        const response = await ask(`${PROJECTS_PATH}/${projectId}/icon?v=1`);
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('image/png');
        expect(response.headers.get('x-content-type-options')).toBe('nosniff');
        expect(response.headers.get('cache-control')).toContain('immutable');
        expect(response.headers.get('content-disposition')).toBe('inline');
        // Only an SVG can carry script; a PNG needs no policy of its own.
        expect(response.headers.get('content-security-policy')).toBeNull();
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array(PNG));
    });

    test('an SVG comes with a policy that allows nothing but its own styles', async () => {
        await rm(join(folder, '.ruimte', 'icon.png'));
        await writeFile(join(folder, '.ruimte', 'icon.svg'), SVG);
        // A fresh open re-reads the folder, the way `project.open` does for a client.
        await store.openProject({ projectId });

        const response = await ask(`${PROJECTS_PATH}/${projectId}/icon?v=1`);
        expect(response.headers.get('content-type')).toBe('image/svg+xml');
        expect(response.headers.get('content-security-policy')).toBe("default-src 'none'; style-src 'unsafe-inline'");
    });

    test('serves the dark variant only when it is asked for', async () => {
        await writeFile(join(folder, '.ruimte', 'icon_dark.png'), Buffer.concat([PNG, Buffer.from([0x7f])]));
        await store.openProject({ projectId });

        const light = await ask(`${PROJECTS_PATH}/${projectId}/icon?v=1`);
        const dark = await ask(`${PROJECTS_PATH}/${projectId}/icon?v=1&theme=dark`);
        expect((await light.arrayBuffer()).byteLength).toBe(PNG.length);
        expect((await dark.arrayBuffer()).byteLength).toBe(PNG.length + 1);
    });

    test('a client from elsewhere needs the token the socket needs', async () => {
        // An empty authorization header takes the local secret off, so only the query speaks.
        const refused = await ask(`${PROJECTS_PATH}/${projectId}/icon?v=1`, '192.168.1.20', { headers: { authorization: '' } });
        expect(refused.status).toBe(401);

        const wrong = await ask(`${PROJECTS_PATH}/${projectId}/icon?v=1&token=nope`, '192.168.1.20', { headers: { authorization: '' } });
        expect(wrong.status).toBe(401);

        const paired = await auth.pair(auth.issuePairingToken(), { label: 'a laptop' });
        const allowed = await ask(`${PROJECTS_PATH}/${projectId}/icon?v=1&token=${paired!.sessionToken!}`, '192.168.1.20', { headers: { authorization: '' } });
        expect(allowed.status).toBe(200);
    });

    test('a page on another origin is refused before the project is even looked up', async () => {
        const response = await ask(`${PROJECTS_PATH}/${projectId}/icon?v=1`, '127.0.0.1', { headers: { origin: 'https://evil.example' } });
        expect(response.status).toBe(403);
    });

    test('answers 404 for another path, another method and a project with no image', async () => {
        expect((await ask(`${PROJECTS_PATH}/${projectId}`)).status).toBe(404);
        expect((await ask(`${PROJECTS_PATH}/${projectId}/canvas`)).status).toBe(404);
        expect((await ask(`${PROJECTS_PATH}/${projectId}/icon`, '127.0.0.1', { method: 'DELETE' })).status).toBe(405);
        expect((await ask(`${PROJECTS_PATH}/nosuchproject/icon`)).status).toBe(404);

        await rm(join(folder, '.ruimte', 'icon.png'));
        await store.openProject({ projectId });
        expect((await ask(`${PROJECTS_PATH}/${projectId}/icon?v=1`)).status).toBe(404);
    });
});
