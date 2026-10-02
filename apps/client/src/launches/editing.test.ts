import { describe, expect, test } from 'bun:test';
import type { GitRepo, LaunchConfigEntry, LaunchesDocument, LaunchSuggestion } from '@ruimte/contracts';
import {
    draftOf,
    draftProblem,
    folderRoots,
    foundText,
    importedLaunches,
    joinFolder,
    newDraft,
    newSuggestions,
    savedLaunches,
    splitFolder,
    suggestionSource,
    uniqueId,
    withImported,
    withoutDraft
} from './editing.ts';

const launch = (id: string, overrides: Partial<LaunchConfigEntry> = {}): LaunchConfigEntry => ({
    id,
    name: id,
    kind: 'service',
    command: `run ${id}`,
    shared: false,
    ...overrides
});

const suggestion = (id: string, overrides: Partial<LaunchSuggestion> = {}, launchOverrides: Partial<LaunchConfigEntry> = {}): LaunchSuggestion => {
    const { shared: _shared, ...config } = launch(id, launchOverrides);
    return { launch: config, source: 'run-xml', path: `backend/dev/run/${id}.run.xml`, detail: 'PHP Built-in Web Server', private: false, ...overrides };
};

const doc = (launches: LaunchConfigEntry[]): LaunchesDocument => ({ rev: 3, launches, approved: [] });

describe('saving', () => {
    test('a new launch is named after itself, and a group that starts it follows', () => {
        const server = {
            ...newDraft('new:1', 'service'),
            env: [
                { id: 0, key: ' APP_ENV ', value: 'dev' },
                { id: 1, key: '', value: 'lost' }
            ]
        };
        server.entry = { ...server.entry, name: ' Run server ', command: ' php -S 0.0.0.0:8000 ', cwd: 'backend/', url: ' http://localhost:8000 ' };
        const group = newDraft('new:2', 'group');
        group.entry = { ...group.entry, name: 'Full stack', launches: ['new:1', 'dev'] };
        const dev = draftOf(launch('dev', { cwd: '.', url: 'http://localhost:5173', extra: 'kept' }));

        expect(savedLaunches([server, group, dev])).toEqual([
            {
                id: 'run-server',
                name: 'Run server',
                kind: 'service',
                shared: false,
                command: 'php -S 0.0.0.0:8000',
                cwd: 'backend',
                url: 'http://localhost:8000',
                env: { APP_ENV: 'dev' }
            },
            { id: 'full-stack', name: 'Full stack', kind: 'group', shared: false, launches: ['run-server', 'dev'] },
            { id: 'dev', name: 'dev', kind: 'service', shared: false, command: 'run dev', url: 'http://localhost:5173', extra: 'kept' }
        ]);
    });

    test('a launch keeps only what its kind reads', () => {
        const task = draftOf(launch('tests', { kind: 'task', url: 'http://localhost:1', launches: ['x'], autostart: false }));
        const group = draftOf(launch('all', { kind: 'group', launches: ['tests'], autostart: true, env: { A: '1' } }));
        expect(savedLaunches([task, group])).toEqual([
            { id: 'tests', name: 'tests', kind: 'task', shared: false, command: 'run tests' },
            { id: 'all', name: 'all', kind: 'group', shared: false, autostart: true, launches: ['tests'] }
        ]);
    });

    test('a new id never takes one that is there', () => {
        const draft = newDraft('new:1', 'task');
        draft.entry = { ...draft.entry, name: 'Dev', command: 'bun run dev' };
        expect(savedLaunches([draftOf(launch('dev')), draft]).map((entry) => entry.id)).toEqual(['dev', 'dev-2']);
        expect(uniqueId('!!!', new Set())).toBe('launch');
    });

    test('the first launch the dialog cannot save', () => {
        const unnamed = { ...newDraft('new:1', 'service') };
        expect(draftProblem([draftOf(launch('ok')), unnamed])).toEqual({ id: 'new:1', problem: 'name' });
        expect(draftProblem([draftOf(launch('a', { command: '  ' }))])).toEqual({ id: 'a', problem: 'command' });
        expect(draftProblem([draftOf(launch('g', { kind: 'group', launches: [] }))])).toEqual({ id: 'g', problem: 'members' });
        expect(draftProblem([draftOf(launch('ok'))])).toBeNull();
    });

    test('a deleted launch leaves the groups that started it', () => {
        const drafts = [draftOf(launch('a')), draftOf(launch('b')), draftOf(launch('all', { kind: 'group', launches: ['a', 'b'] }))];
        expect(withoutDraft(drafts, 'a').map((draft) => [draft.entry.id, draft.entry.launches])).toEqual([
            ['b', undefined],
            ['all', ['b']]
        ]);
    });
});

describe('the folder', () => {
    const repos: GitRepo[] = [
        { path: '/p', label: 'p', kind: 'root' },
        { path: '/p/backend', label: 'backend', kind: 'nested' },
        { path: '/p/backend/vendor/lib', label: 'backend/vendor/lib', kind: 'submodule' }
    ];

    test('is split into the checkout and the path below it', () => {
        const roots = folderRoots(repos);
        expect(roots).toEqual(['', 'backend', 'backend/vendor/lib']);
        expect(splitFolder('backend/public', roots)).toEqual({ root: 'backend', sub: 'public' });
        expect(splitFolder('backend/vendor/lib', roots)).toEqual({ root: 'backend/vendor/lib', sub: '' });
        expect(splitFolder('backendish', roots)).toEqual({ root: '', sub: 'backendish' });
        expect(splitFolder(undefined, roots)).toEqual({ root: '', sub: '' });
        expect(splitFolder('/Users/bas/elsewhere', roots)).toEqual({ root: '', sub: '/Users/bas/elsewhere' });
    });

    test('is joined back', () => {
        expect(joinFolder('backend', ' public/ ')).toBe('backend/public/');
        expect(joinFolder('backend', '')).toBe('backend');
        expect(joinFolder('', './frontend')).toBe('frontend');
        expect(joinFolder('backend', '/abs')).toBe('/abs');
    });
});

describe('the import', () => {
    test('offers only what is not a launch yet', () => {
        const found = [
            suggestion('run-server', {}, { cwd: 'backend', command: 'php -S x' }),
            suggestion('dev', {}, { cwd: 'frontend', command: 'bun run dev' })
        ];
        const document = doc([launch('mine', { cwd: 'backend', command: ' php -S x ' })]);
        expect(newSuggestions(found, document).map((entry) => entry.launch.id)).toEqual(['dev']);
    });

    test('shares what may travel, and keeps ids apart from the launches there', () => {
        const found = [suggestion('dev'), suggestion('debug', { private: true })];
        expect(importedLaunches(found, true, doc([launch('dev')])).map((entry) => [entry.id, entry.shared])).toEqual([
            ['dev-2', true],
            ['debug', false]
        ]);
        expect(importedLaunches(found, false, doc([])).map((entry) => entry.shared)).toEqual([false, false]);
    });

    test('from the editor it adds to the drafts, which keep what was typed', () => {
        const edited = draftOf(launch('dev', { name: 'Dev, renamed' }));
        const typed = {
            ...newDraft('new:1', 'service'),
            entry: { id: 'new:1', name: 'Worker', kind: 'service' as const, shared: false, command: 'bun worker' }
        };
        const found = [suggestion('dev', {}, { command: 'bun run dev' }), suggestion('worker', {}, { command: 'bun worker' })];

        const offered = newSuggestions(found, { launches: savedLaunches([edited, typed]) });
        expect(offered.map((entry) => entry.launch.id)).toEqual(['dev']);

        const next = withImported([edited, typed], offered, false);
        expect(next.slice(0, 2)).toEqual([edited, typed]);
        expect(next.slice(2).map((draft) => [draft.entry.id, draft.entry.command, draft.fresh])).toEqual([['dev-2', 'bun run dev', false]]);
    });

    test('says what it found, and where', () => {
        const runFiles = ['a', 'b', 'c', 'd', 'e'].map((id) => suggestion(id));
        const scripts = ['dev', 'build', 'preview', 'check'].map((id) => suggestion(id, { source: 'package-json', path: 'frontend/package.json', detail: id }));
        const phpunit = suggestion('main', { unsupported: 'PHPUnit' });
        expect(foundText([...runFiles, phpunit, ...scripts])).toBe('5 run configurations in backend/dev/run and 4 scripts in frontend/package.json.');
        expect(foundText([suggestion('a'), suggestion('b', { path: 'web/.run/b.run.xml' })])).toBe('2 run configurations in 2 folders.');
        expect(foundText([scripts[0]!, suggestion('x', { source: 'composer-json', path: 'composer.json' })])).toBe('2 scripts in 2 files.');
        expect(foundText([phpunit])).toBeNull();
    });

    test('names the file a script came from', () => {
        expect(suggestionSource(suggestion('dev', { source: 'package-json', path: 'frontend/package.json' }))).toBe('frontend · package.json');
        expect(suggestionSource(suggestion('dev', { source: 'composer-json', path: 'composer.json' }))).toBe('composer.json');
        expect(suggestionSource(suggestion('run'))).toBe('PHP Built-in Web Server');
    });
});
