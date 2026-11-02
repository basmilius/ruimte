import { describe, expect, test } from 'bun:test';
import client from '../../../client/package.json' with { type: 'json' };
import { VERSION } from '../version.ts';
import { CLIENT_REACT_MAJOR, scaffoldFiles, scaffoldFolder, scaffoldProblem, type ScaffoldAnswers } from './scaffold.ts';

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

        const greeting = /return ('.*');/.exec(scaffoldFiles({ ...answers, name })['server/index.ts'] ?? '')?.[1] ?? '';
        const title = /title: ('.*'), icon/.exec(scaffoldFiles({ ...answers, name })['client/index.ts'] ?? '')?.[1] ?? '';

        expect(new Function(`return ${greeting};`)()).toBe(`Hello from ${name}`);
        expect(new Function(`return ${title};`)()).toBe(name);
    });

    test('writes code in single quotes, as the rest of a project does', () => {
        const files = scaffoldFiles(answers);

        expect(files['client/index.ts']).toContain("title: 'Builds'");
        expect(files['server/index.ts']).toContain("return 'Hello from Builds';");
        expect(files['test/extension.test.ts']).toContain("describe('Builds', () => {");
        expect(scaffoldFiles({ ...answers, parts: 'client' })['client/Main.tsx']).toContain("{'Hello from Builds'}");
    });

    test('writes a manifest with every field a person reads, and leaves what a build writes out of git', () => {
        const files = scaffoldFiles({ ...answers, description: 'Shows the builds.' });

        expect(JSON.parse(files['manifest.json'] ?? '{}')).toMatchObject({ description: 'Shows the builds.', color: '#0891b2' });
        expect(JSON.parse(scaffoldFiles(answers)['manifest.json'] ?? '{}')).toHaveProperty('description', '');
        expect(files['.gitignore']?.split('\n')).toEqual(['node_modules/', 'dist/', '.ruimte-build-*/', '']);
    });

    test('goes into a folder named after the second half of its id', () => {
        expect(scaffoldFolder({ ...answers, id: 'acme.standup' })).toBe('standup');
    });

    test('starts on the types of the Ruimte that made it', () => {
        const manifest = JSON.parse(scaffoldFiles(answers)['package.json'] ?? '{}') as { devDependencies: Record<string, string> };

        expect(manifest.devDependencies['@ruimte/extension']).toBe(VERSION === '0.0.0' ? 'latest' : VERSION);
    });

    test('refuses answers that would make no extension, before a file is written', () => {
        expect(scaffoldProblem(answers)).toBeNull();
        expect(scaffoldProblem({ ...answers, id: 'acme' })).toContain('id');
        expect(scaffoldProblem({ ...answers, parts: 'all' as ScaffoldAnswers['parts'] })).toContain('--parts');
        expect(scaffoldProblem({ ...answers, surface: 'window' as ScaffoldAnswers['surface'] })).toContain('--surface');
    });
});
