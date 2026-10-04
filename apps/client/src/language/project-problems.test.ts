import { describe, expect, test } from 'bun:test';
import { FakeLanguageTransport } from './fake-daemon';
import { countsOf, ProjectProblems } from './project-problems';

const range = (line: number) => ({ start: { line, character: 2 }, end: { line, character: 5 } });

describe('the problems of a project', () => {
    test('are kept per file and server, worst first, and dropped when a server reports none', () => {
        const transport = new FakeLanguageTransport();
        const problems = new ProjectProblems(transport, 'p1');
        let heard = 0;
        problems.subscribe(() => heard++);
        transport.emit('language.diagnostics', {
            projectId: 'p1',
            path: 'src/b.ts',
            server: 'typescript',
            diagnostics: [
                { range: range(4), message: 'warn', severity: 2 },
                { range: range(9), message: 'error', severity: 1 },
                { range: range(1), message: 'unused', severity: 4 }
            ]
        });
        transport.emit('language.diagnostics', {
            projectId: 'p1',
            path: 'src/a.ts',
            server: 'vue',
            diagnostics: [{ range: range(0), message: 'info', severity: 3 }]
        });
        transport.emit('language.diagnostics', { projectId: 'p2', path: 'src/c.ts', server: 'vue', diagnostics: [{ range: range(0), message: 'elsewhere' }] });
        const files = problems.getSnapshot();
        expect(files.map((file) => file.path)).toEqual(['src/a.ts', 'src/b.ts']);
        expect(files[1]!.rows.map((row) => row.diagnostic.message)).toEqual(['error', 'warn']);
        expect(countsOf(files)).toEqual({ error: 1, warning: 1, info: 1 });
        expect(problems.getSnapshot()).toBe(files);
        transport.emit('language.diagnostics', { projectId: 'p1', path: 'src/a.ts', server: 'vue', diagnostics: [] });
        expect(problems.getSnapshot().map((file) => file.path)).toEqual(['src/b.ts']);
        expect(heard).toBe(3);
        problems.dispose();
        transport.emit('language.diagnostics', { projectId: 'p1', path: 'src/z.ts', server: 'vue', diagnostics: [{ range: range(0), message: 'late' }] });
        expect(problems.getSnapshot()).toHaveLength(1);
    });
});
