import { describe, expect, test } from 'bun:test';
import client from '../../../client/package.json' with { type: 'json' };
import { CLIENT_REACT_MAJOR, scaffoldFiles, scaffoldProblem, type ScaffoldAnswers } from './scaffold.ts';

const answers: ScaffoldAnswers = { name: 'Builds', id: 'acme.builds', description: '', parts: 'both', surface: 'panel', git: false };

describe('a new extension', () => {
    test('starts on the major of React the client draws extensions with', () => {
        expect(client.dependencies.react).toStartWith(`^${CLIENT_REACT_MAJOR}.`);
    });

    test('writes any name into code that still parses and says it as it is', () => {
        const name = 'A < B {builds} \\ \'quoted\' "too"\nnext line';
        const transpiler = new Bun.Transpiler({ loader: 'tsx' });

        for (const parts of ['both', 'client'] as const) {
            for (const [path, code] of Object.entries(scaffoldFiles({ ...answers, name, parts }))) {
                if (/\.tsx?$/.test(path)) {
                    expect(() => transpiler.transformSync(code)).not.toThrow();
                }
            }
        }

        const files = scaffoldFiles({ ...answers, name });

        expect(files['server/index.ts']).toContain(JSON.stringify(`Hello from ${name}`));
        expect(scaffoldFiles({ ...answers, name, parts: 'client' })['client/Main.tsx']).toContain(`{${JSON.stringify(`Hello from ${name}`)}}`);
    });

    test('refuses answers that would make no extension, before a file is written', () => {
        expect(scaffoldProblem(answers)).toBeNull();
        expect(scaffoldProblem({ ...answers, id: 'acme' })).toContain('id');
        expect(scaffoldProblem({ ...answers, parts: 'all' as ScaffoldAnswers['parts'] })).toContain('--parts');
        expect(scaffoldProblem({ ...answers, surface: 'window' as ScaffoldAnswers['surface'] })).toContain('--surface');
    });
});
