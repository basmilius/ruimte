import { describe, expect, test } from 'bun:test';
import { voiceToolsFor } from '@ruimte/actions';
import type { ProjectView } from '@ruimte/contracts';
import { kindsIn, voiceDomainsFor } from '@/voice/domains';

const NOTHING = { sessions: false, content: false, pages: false, folder: false, repository: false };

describe('the domains Voice gets', () => {
    test('an empty project without a folder gets what finds, makes and prompts, and nothing about git, files or content', () => {
        expect(voiceDomainsFor(NOTHING)).toEqual(['workspace', 'views', 'canvas', 'layout', 'communicate', 'projects', 'machine']);
    });

    test('git needs a folder with a repository, and the rest follows what the project holds', () => {
        expect(voiceDomainsFor({ ...NOTHING, folder: true })).toContain('files');
        expect(voiceDomainsFor({ ...NOTHING, folder: true })).not.toContain('developer');
        expect(voiceDomainsFor({ ...NOTHING, repository: true })).not.toContain('developer');
        expect(voiceDomainsFor({ sessions: true, content: true, pages: true, folder: true, repository: true })).toEqual([
            'workspace',
            'views',
            'canvas',
            'layout',
            'communicate',
            'sessions',
            'plans',
            'agents',
            'projects',
            'developer',
            'files',
            'content',
            'pages',
            'machine'
        ]);
    });

    test('kinds count as views and as nodes on a canvas', () => {
        const views = [
            {
                kind: 'canvas',
                id: 'main',
                name: 'Main',
                nodes: [{ id: 'n', kind: 'note', title: 'Todo', x: 0, y: 0, w: 1, h: 1 }],
                texts: [],
                edges: [],
                layouts: []
            },
            { kind: 'browser', id: 'web', name: 'Docs', url: 'https://example.test' }
        ] as unknown as ProjectView[];
        expect([...kindsIn(views)].sort()).toEqual(['browser', 'canvas', 'note']);
    });

    test('an ordinary project sends far less than every tool', () => {
        const full = JSON.stringify(voiceToolsFor(voiceDomainsFor({ sessions: true, content: true, pages: true, folder: true, repository: true }))).length;
        const plain = JSON.stringify(voiceToolsFor(voiceDomainsFor({ ...NOTHING, sessions: true, folder: true }))).length;
        expect(plain).toBeLessThan(full * 0.7);
    });
});
