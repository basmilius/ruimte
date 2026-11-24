import { beforeEach, describe, expect, test } from 'bun:test';
import type { ExtensionProblem, LanguageDiagnosticsEvent } from '@ruimte/contracts';
import { ExtensionProblems } from './problems.ts';

const LINTEL = { extension: 'dev.lintel', id: 'rules', title: 'Lintel' };
const SCAN = { extension: 'dev.lintel', id: 'scan', title: 'Lintel scan' };
const OTHER = { extension: 'acme.audit', id: 'audit', title: 'Audit' };
const todo: ExtensionProblem = { line: 2, column: 4, endColumn: 8, severity: 'warning', message: 'A TODO is left here', code: 'todo' };
const long: ExtensionProblem = { line: 9, severity: 'hint', message: 'This line is long' };

let problems: ExtensionProblems;
let heard: Record<string, LanguageDiagnosticsEvent[]>;

function hear(clientId: string): void {
    heard[clientId] = [];
    problems.subscribe(clientId, (event) => {
        if (event.event === 'language.diagnostics') {
            heard[clientId]?.push(event.payload);
        }
    });
}

beforeEach(() => {
    problems = new ExtensionProblems({
        folderOf: (projectId) => (projectId === 'p1' || projectId === 'p2' ? `/work/${projectId}` : null),
        holders: (projectId) => (projectId === 'p1' ? ['holder'] : [])
    });
    heard = {};
    hear('holder');
    hear('late');
});

describe('the problems the sources of extensions report', () => {
    test('reach the clients that hold the project as diagnostics under the name of the source, counted from 0', async () => {
        await problems.report(LINTEL, 'p1', [{ path: 'src/a.ts', problems: [todo, long] }]);

        expect(heard.holder).toEqual([
            {
                projectId: 'p1',
                path: 'src/a.ts',
                server: 'dev.lintel/rules',
                diagnostics: [
                    {
                        range: { start: { line: 1, character: 3 }, end: { line: 1, character: 7 } },
                        severity: 2,
                        message: 'A TODO is left here',
                        source: 'Lintel',
                        code: 'todo'
                    },
                    { range: { start: { line: 8, character: 0 }, end: { line: 8, character: 0 } }, severity: 4, message: 'This line is long', source: 'Lintel' }
                ]
            }
        ]);
        expect(heard.late).toEqual([]);
    });

    test('replace what a source said of the files a report names, and of no other file or source', async () => {
        await problems.report(LINTEL, 'p1', [
            { path: 'src/a.ts', problems: [todo] },
            { path: '/work/p1/src/b.ts', problems: [long] }
        ]);
        await problems.report(OTHER, 'p1', [{ path: 'src/a.ts', problems: [long] }]);
        await problems.report(LINTEL, 'p1', [
            { path: 'src/a.ts', problems: [] },
            { path: 'src/never.ts', problems: [] }
        ]);

        expect(problems.of('p1').map((file) => [file.server, file.path, file.problems.length])).toEqual([
            ['dev.lintel/rules', 'src/b.ts', 1],
            ['acme.audit/audit', 'src/a.ts', 1]
        ]);
        // A file the source never spoke for is taken back from nobody.
        expect(heard.holder?.map((event) => [event.server, event.path, event.diagnostics.length])).toEqual([
            ['dev.lintel/rules', 'src/a.ts', 1],
            ['dev.lintel/rules', 'src/b.ts', 1],
            ['acme.audit/audit', 'src/a.ts', 1],
            ['dev.lintel/rules', 'src/a.ts', 0]
        ]);
        expect(problems.sourcesOf('p1')).toEqual([
            { server: 'dev.lintel/rules', title: 'Lintel' },
            { server: 'acme.audit/audit', title: 'Audit' }
        ]);
    });

    test('are sent whole to a client that asks after they were reported', async () => {
        await problems.report(LINTEL, 'p1', [{ path: 'src/a.ts', problems: [todo] }]);
        problems.replay('late', 'p1');
        problems.replay('late', 'p2');

        expect(heard.late?.map((event) => [event.projectId, event.path, event.diagnostics.length])).toEqual([['p1', 'src/a.ts', 1]]);
    });

    test('go when the source clears them, when its extension goes and when the project closes', async () => {
        await problems.report(LINTEL, 'p1', [{ path: 'src/a.ts', problems: [todo] }]);
        await problems.report(SCAN, 'p1', [{ path: 'src/b.ts', problems: [long] }]);
        await problems.report(OTHER, 'p1', [{ path: 'src/c.ts', problems: [long] }]);
        await problems.report(LINTEL, 'p2', [{ path: 'src/a.ts', problems: [todo] }]);
        heard.holder = [];

        problems.clear('dev.lintel', 'rules', 'p1');

        expect(problems.of('p1').map((file) => file.server)).toEqual(['dev.lintel/scan', 'acme.audit/audit']);
        expect(problems.of('p2')).toHaveLength(1);

        problems.drop('dev.lintel');

        expect(problems.of('p1').map((file) => file.server)).toEqual(['acme.audit/audit']);
        expect(problems.of('p2')).toEqual([]);
        expect(heard.holder?.map((event) => [event.path, event.diagnostics.length])).toEqual([
            ['src/a.ts', 0],
            ['src/b.ts', 0]
        ]);

        problems.dropProject('p1');

        expect(problems.of('p1')).toEqual([]);
        expect(problems.sourcesOf('p1')).toEqual([]);
    });

    test('are refused outside the project folder, for a project the machine does not know and past 500 files of one source', async () => {
        const files = (from: number, count: number) => Array.from({ length: count }, (_, index) => ({ path: `src/${from + index}.ts`, problems: [long] }));

        await expect(problems.report(LINTEL, 'p1', [{ path: '../p2/a.ts', problems: [todo] }])).rejects.toMatchObject({ code: 'outside-project' });
        await expect(problems.report(LINTEL, 'gone', [{ path: 'a.ts', problems: [todo] }])).rejects.toMatchObject({ code: 'not-found' });

        await problems.report(LINTEL, 'p1', files(0, 300));

        await expect(problems.report(LINTEL, 'p1', files(300, 201))).rejects.toMatchObject({ code: 'limit' });
        expect(problems.of('p1')).toHaveLength(300);

        // The same 300 again, and 200 more beside them, is what one source holds at most.
        await problems.report(LINTEL, 'p1', [...files(0, 300), ...files(300, 200)]);
        await problems.report(OTHER, 'p1', files(0, 500));

        expect(problems.of('p1')).toHaveLength(1000);
    });
});
