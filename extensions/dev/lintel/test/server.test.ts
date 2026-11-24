import { describe, expect, test } from 'bun:test';
import { createTestServer } from '@ruimte/extension/testing';
import type { LintelServer } from '../server';

const PROJECT = { id: 'project-1', name: 'Project', folder: '/project' };
const LONG = `const text = '${'x'.repeat(120)}';`;
const FILES = {
    'src/app.ts': ['export const port = 5173;', '// TODO: read the port from the environment', ''].join('\n'),
    'src/clean.ts': 'export const clean = true;\n',
    'src/wide.ts': `${LONG}\nexport const tail = 1;   \n`,
    'node_modules/pkg/index.js': '// TODO: never read\n',
    '.cache/out.js': '// TODO: never read\n',
    'logo.png': 'TODO, were it text'
};

async function opened(files: Record<string, string> = FILES) {
    const server = await createTestServer<LintelServer>({ files });

    server.fire('project.opened', { project: PROJECT });
    await server.call('found', PROJECT.id);

    return server;
}

describe('Lintel on the machine', () => {
    test('checks the files of a project a person opens against its rules, and reports what it finds under its source', async () => {
        const server = await opened();

        expect(server.problems).toEqual([
            {
                source: 'rules',
                files: [
                    {
                        path: 'src/app.ts',
                        problems: [{ line: 2, column: 4, endLine: 2, endColumn: 8, severity: 'information', message: 'A TODO is left here', code: 'marker' }]
                    },
                    {
                        path: 'src/wide.ts',
                        problems: [
                            {
                                line: 1,
                                column: 121,
                                endLine: 1,
                                endColumn: LONG.length + 1,
                                severity: 'warning',
                                message: `This line is ${LONG.length} characters long, and 120 is the most`,
                                code: 'line-length'
                            },
                            {
                                line: 2,
                                column: 23,
                                endLine: 2,
                                endColumn: 26,
                                severity: 'hint',
                                message: 'Space is left at the end of this line',
                                code: 'trailing-space'
                            }
                        ]
                    }
                ]
            }
        ]);
        expect(await server.call('found', PROJECT.id)).toEqual({ ok: true, value: { files: 2, problems: 3 } });
    });

    test('checks again when a file changes, and takes back what it said of a file that is clean or gone', async () => {
        const server = await opened();

        server.writeFile('src/app.ts', 'export const port = 5173;\n');
        server.writeFile('src/wide.ts', null);
        server.writeFile('src/new.ts', '// FIXME: later\n');
        await server.call('found', PROJECT.id);

        expect(server.problems).toEqual([
            {
                source: 'rules',
                files: [
                    {
                        path: 'src/new.ts',
                        problems: [{ line: 1, column: 4, endLine: 1, endColumn: 9, severity: 'information', message: 'A FIXME is left here', code: 'marker' }]
                    }
                ]
            }
        ]);
    });

    test('checks every open project again on its clock, for a change no watch told it of', async () => {
        const server = await opened();

        // Written behind the watch, as a disk that reports no changes would have it.
        server.files['src/clean.ts'] = '// TODO: found on the clock\n';

        expect(server.problems[0]?.files.map((file) => file.path)).toEqual(['src/app.ts', 'src/wide.ts']);

        await server.clock.advance('5m');

        expect(server.problems[0]?.files.map((file) => file.path).toSorted()).toEqual(['src/app.ts', 'src/clean.ts', 'src/wide.ts']);
    });

    test('stops following a project that closes, and takes back everything it said there', async () => {
        const server = await opened();

        server.fire('project.closed', { project: { id: PROJECT.id } });
        await server.call('found', PROJECT.id);

        expect(server.problems).toEqual([]);
        expect(await server.call('found', PROJECT.id)).toEqual({ ok: true, value: null });

        const asked = server.asked.length;

        server.writeFile('src/app.ts', '// TODO: nobody looks\n');
        await server.clock.advance('5m');

        expect(server.asked.length).toBe(asked);
    });

    test('checks no project without the permission to follow them, and reports nothing without the one to read files', async () => {
        const base = { 'problems.provide': 'Lists', clock: 'Checks again' };
        const unfollowed = await createTestServer<LintelServer>({ manifest: { permissions: base }, files: FILES });
        const unread = await createTestServer<LintelServer>({ manifest: { permissions: { ...base, 'projects.read': 'Follows' } }, files: FILES });

        unfollowed.fire('project.opened', { project: PROJECT });
        unread.fire('project.opened', { project: PROJECT });

        expect(await unfollowed.call('found', PROJECT.id)).toEqual({ ok: true, value: null });
        expect(unfollowed.logs).toContain('project.opened needs the permission projects.read in manifest.json');
        expect(await unread.call('found', PROJECT.id)).toEqual({ ok: true, value: { files: 0, problems: 0 } });
        expect(unread.problems).toEqual([{ source: 'rules', files: [] }]);
        expect(unread.logs).toContain('files.list answered permission-denied: dev.lintel did not ask for the permission files.read in its manifest');
    });

    test('names no source its manifest does not list, name as proposed or ask the permission for', async () => {
        await expect(createTestServer<LintelServer>({ manifest: { provides: { problemSources: ['other'] } } })).rejects.toThrow(
            'defineProblemSource got rules, which manifest.json does not list under provides.problemSources'
        );
        await expect(createTestServer<LintelServer>({ manifest: { proposed: [] } })).rejects.toThrow(
            'defineProblemSource is still proposed; name problemSources under proposed in manifest.json'
        );
        await expect(createTestServer<LintelServer>({ manifest: { permissions: {} } })).rejects.toThrow(
            'dev.lintel did not ask for the permission problems.provide in its manifest'
        );
        await expect(createTestServer<LintelServer>({ provenance: 'installed' })).rejects.toThrow(
            'This extension uses a part of Ruimte that is not final yet (problemSources). It works while its author develops it, and an installed extension cannot use it.'
        );
    });
});
