import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PortGrants, portsStore } from './port-grants.ts';
import { testGrants } from './port-test-helpers.ts';

const folders: string[] = [];

afterEach(() => {
    folders.splice(0).forEach((folder) => rmSync(folder, { recursive: true, force: true }));
});

describe('PortGrants', () => {
    test('shares one literal endpoint of one project and answers the same grant the second time', () => {
        const { grants, changes } = testGrants();
        const first = grants.share('project-1', 3000, '127.0.0.1', 'person');

        expect(first).toMatchObject({ projectId: 'project-1', port: 3000, host: '127.0.0.1', sharedBy: 'person' });
        expect(grants.share('project-1', 3000, '127.0.0.1', 'agent')).toBe(first);
        expect(changes()).toBe(1);
    });

    test('treats the other address family and the other project as other grants', () => {
        const { grants } = testGrants();

        grants.share('project-1', 3000, '127.0.0.1', 'person');
        grants.share('project-1', 3000, '::1', 'person');
        grants.share('project-2', 3000, '127.0.0.1', 'person');

        expect(grants.list()).toHaveLength(3);
    });

    test('refuses the ports Ruimte listens on, at sharing and again when a stream opens', () => {
        const denied = [4210];
        const { grants } = testGrants(denied);

        expect(() => grants.share('project-1', 4210, '127.0.0.1', 'person')).toThrow(/belongs to Ruimte/);

        const grant = grants.share('project-1', 4300, '127.0.0.1', 'person');

        denied.push(4300);

        expect(grants.deniedReason(grant)).toMatch(/belongs to Ruimte/);
    });

    test('revokes a grant and tells whoever listens, once', () => {
        const { grants, changes } = testGrants();
        const grant = grants.share('project-1', 3000, '127.0.0.1', 'person');
        const revoked: string[] = [];

        grants.onRevoked((entry) => revoked.push(entry.id));

        expect(grants.revoke(grant.id)).toBe(true);
        expect(grants.revoke(grant.id)).toBe(false);
        expect(revoked).toEqual([grant.id]);
        expect(grants.list()).toEqual([]);
        expect(changes()).toBe(2);
    });

    test('keeps a grant across a restart until it is revoked', () => {
        const home = mkdtempSync(join(tmpdir(), 'ruimte-ports-'));
        folders.push(home);

        const options = { store: portsStore(home), deniedPorts: () => [], random: () => 'kept', now: () => 5, changed: () => undefined };
        const before = new PortGrants(options);
        before.share('project-1', 5173, '127.0.0.1', 'person');

        const after = new PortGrants({ ...options, store: portsStore(home) });

        expect(after.list()).toEqual([{ id: 'kept', projectId: 'project-1', host: '127.0.0.1', port: 5173, sharedBy: 'person', createdAt: 5 }]);

        after.revoke('kept');

        expect(new PortGrants({ ...options, store: portsStore(home) }).list()).toEqual([]);
    });
});
