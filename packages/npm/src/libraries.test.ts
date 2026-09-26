import { describe, expect, test } from 'bun:test';
import { libraryManifest, publishedExports } from './libraries';

describe('publishedExports', () => {
    test('a source file points at its JavaScript and its declarations', () => {
        expect(publishedExports({ './Button': './src/Button.tsx', './format/number': './src/format/number.ts' })).toEqual({
            './Button': { types: './dist/Button.d.ts', default: './dist/Button.js' },
            './format/number': { types: './dist/format/number.d.ts', default: './dist/format/number.js' }
        });
    });

    test('a pattern keeps its wildcard', () => {
        expect(publishedExports({ './*': './src/*.ts' })).toEqual({ './*': { types: './dist/*.d.ts', default: './dist/*.js' } });
    });

    test('a stylesheet or a JSON file is copied as it is', () => {
        expect(publishedExports({ './theme.css': './src/theme.css', './locales/*.json': './src/locales/*.json' })).toEqual({
            './theme.css': './dist/theme.css',
            './locales/*.json': './dist/locales/*.json'
        });
    });
});

describe('libraryManifest', () => {
    test('pins a workspace dependency to the release and keeps the rest', () => {
        const manifest = libraryManifest(
            'agents',
            {
                name: '@ruimte/agents',
                description: 'The chat host.',
                exports: { './*': './src/*.ts' },
                dependencies: { '@ruimte/agent-contracts': 'workspace:*', zod: '^4.6.5' },
                peerDependencies: { react: '^19.3.0' }
            },
            '0.7.0'
        );
        expect(manifest).toMatchObject({
            name: '@ruimte/agents',
            version: '0.7.0',
            description: 'The chat host.',
            license: 'FSL-1.1-MIT',
            repository: { type: 'git', url: 'git+https://github.com/basmilius/ruimte.git', directory: 'packages/agents' },
            type: 'module',
            files: ['dist'],
            dependencies: { '@ruimte/agent-contracts': '0.7.0', zod: '^4.6.5' },
            peerDependencies: { react: '^19.3.0' }
        });
        expect(manifest).not.toHaveProperty('private');
    });
});
