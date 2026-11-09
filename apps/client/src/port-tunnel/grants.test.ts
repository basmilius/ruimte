import { describe, expect, test } from 'bun:test';
import type { PortGrant } from '@ruimte/contracts';
import { grantForUrl, loopbackPort } from './grants';

const grant = (patch: Partial<PortGrant> = {}): PortGrant => ({
    id: 'g1',
    projectId: 'project-1',
    host: '127.0.0.1',
    port: 3000,
    sharedBy: 'person',
    createdAt: 1,
    ...patch
});

describe('loopbackPort', () => {
    test('reads the port of the loopback spellings over http', () => {
        expect(loopbackPort('http://localhost:3000/a')).toBe(3000);
        expect(loopbackPort('http://127.0.0.1:5173')).toBe(5173);
        expect(loopbackPort('http://[::1]:8080/')).toBe(8080);
        expect(loopbackPort('http://LOCALHOST/')).toBe(80);
    });

    test('has no port for anything else', () => {
        for (const url of [
            'https://localhost:3000/',
            'http://example.com:3000/',
            'http://localhost.example.com:3000/',
            'http://user@localhost:3000/',
            'http://0.0.0.0:3000/',
            'not a url'
        ]) {
            expect(loopbackPort(url)).toBeNull();
        }
    });
});

describe('grantForUrl', () => {
    test('picks the grant of this project for the port', () => {
        const wanted = grant();

        expect(grantForUrl([grant({ id: 'other', port: 4000 }), wanted], 'http://localhost:3000/', 'project-1')).toBe(wanted);
    });

    test('never uses a grant of another project, or one before the list is known', () => {
        expect(grantForUrl([grant({ projectId: 'project-2' })], 'http://localhost:3000/', 'project-1')).toBeNull();
        expect(grantForUrl(undefined, 'http://localhost:3000/', 'project-1')).toBeNull();
        expect(grantForUrl([grant()], 'http://localhost:3000/', null)).toBeNull();
    });

    test('has no grant for an address that is not the shared port', () => {
        expect(grantForUrl([grant()], 'http://localhost:3001/', 'project-1')).toBeNull();
        expect(grantForUrl([grant()], 'https://example.com/', 'project-1')).toBeNull();
    });
});
