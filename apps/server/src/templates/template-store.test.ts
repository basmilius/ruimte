import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LiveTemplateInput, TemplateChangedEvent } from '@ruimte/contracts';
import { fileExists } from '@adecore/agents';
import { FakeWatch } from '@adecore/agents/testing';
import { tempHomes } from '../temp-home-test-helpers.ts';
import { TemplateStore } from './template-store.ts';

const homes = tempHomes('ruimte-templates-');

const log: LiveTemplateInput = { key: 'log', body: 'console.log($0);', languages: ['javascript'] };

let home: string;
let folder: string;
let fake: FakeWatch;
let store: TemplateStore;
let holders: string[];
let heard: Record<string, TemplateChangedEvent[]>;

function personalPath(): string {
    return join(home, 'editor-templates.json');
}

function projectPath(): string {
    return join(folder, '.ruimte', 'templates.json');
}

async function readJson(path: string): Promise<Record<string, unknown>> {
    return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
}

async function writeJson(path: string, file: unknown): Promise<void> {
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, `${JSON.stringify(file, null, 4)}\n`);
}

function templateEvents(clientId: string): TemplateChangedEvent[] {
    return heard[clientId]!;
}

beforeEach(async () => {
    const root = await homes();
    home = join(root, 'home');
    folder = join(root, 'repo');
    await mkdir(home, { recursive: true });
    await mkdir(folder, { recursive: true });
    fake = new FakeWatch();
    holders = ['c1'];
    store = new TemplateStore({
        path: personalPath(),
        projects: { folderOf: (projectId) => (projectId === 'p1' ? folder : null), holdersOf: (projectId) => (projectId === 'p1' ? holders : []) },
        seams: fake,
        now: () => 1000
    });
    heard = { c1: [], c2: [] };

    for (const clientId of Object.keys(heard)) {
        store.subscribe(clientId, (event) => {
            if (event.event === 'template.changed') {
                heard[clientId]!.push(event.payload);
            }
        });
    }
});

afterEach(() => {
    store.closeAll();
});

describe('reading', () => {
    test('a machine without templates answers empty lists and writes nothing', async () => {
        const result = await store.list('c1', 'p1');

        expect(result.personal).toMatchObject({ live: [], postfix: [], disabled: [], settings: {} });
        expect(result.project).toMatchObject({ live: [], postfix: [] });
        expect(await fileExists(personalPath())).toBe(false);
        expect(await fileExists(projectPath())).toBe(false);
    });

    test('the project part goes to a client that holds the project only', async () => {
        expect((await store.list('c2', 'p1')).project).toBeNull();
        expect((await store.list('c1', undefined)).project).toBeNull();
        expect((await store.list('c1', 'unknown')).project).toBeNull();
    });

    test('an entry this release cannot read stays out of the answer', async () => {
        await writeJson(personalPath(), { version: 1, live: [{ nonsense: true }, { id: 'a', key: 'k', body: 'b', languages: ['php'] }] });

        expect((await store.list('c1', undefined)).personal.live.map((template) => template.id)).toEqual(['a']);
    });

    test('a file from a newer Ruimte is refused and left as it is', async () => {
        await writeJson(personalPath(), { version: 2, live: [] });
        const before = await readFile(personalPath(), 'utf8');

        await expect(store.list('c1', undefined)).rejects.toMatchObject({ code: 'templates-too-new' });
        await expect(store.configure({ revision: 0, disabled: ['builtin.javascript.log'] })).rejects.toMatchObject({ code: 'templates-too-new' });
        expect(await readFile(personalPath(), 'utf8')).toBe(before);
    });

    test('a project file from a newer Ruimte is refused and left as it is', async () => {
        await writeJson(projectPath(), { version: 2, live: [] });
        const before = await readFile(projectPath(), 'utf8');

        const listed = await store.list('c1', 'p1');

        expect(listed.project).toBeNull();
        expect(listed.projectTooNew).toBe(true);
        expect(listed.personal.live).toEqual([]);
        await expect(store.save('c1', { scope: 'project', projectId: 'p1', revision: 0, kind: 'live', template: log })).rejects.toMatchObject({
            code: 'templates-too-new'
        });
        expect(await readFile(projectPath(), 'utf8')).toBe(before);
    });

    test('a project file that is JSON but breaks the schema is left in place and read as no templates', async () => {
        await writeJson(projectPath(), { version: 1, live: 'not a list' });
        const before = await readFile(projectPath(), 'utf8');

        const listed = await store.list('c1', 'p1');

        expect(listed.project).toBeNull();
        expect(listed.projectInvalid).toBe(true);
        expect(listed.projectTooNew).toBeUndefined();
        await expect(store.save('c1', { scope: 'project', projectId: 'p1', revision: 0, kind: 'live', template: log })).rejects.toMatchObject({
            code: 'templates-invalid'
        });
        expect(await readFile(projectPath(), 'utf8')).toBe(before);
        expect(await readdir(join(folder, '.ruimte'))).toEqual(['templates.json']);
    });

    test('a personal file that is JSON but breaks the schema is refused and left in place', async () => {
        await writeJson(personalPath(), { version: 1, disabled: 4 });
        const before = await readFile(personalPath(), 'utf8');

        await expect(store.list('c1', undefined)).rejects.toMatchObject({ code: 'templates-invalid' });
        expect(await readFile(personalPath(), 'utf8')).toBe(before);
        expect(await readdir(home)).toEqual(['editor-templates.json']);
    });

    test('a file that is not JSON is set aside', async () => {
        await mkdir(join(folder, '.ruimte'), { recursive: true });
        await writeFile(projectPath(), '{ nope');

        const listed = await store.list('c1', 'p1');

        expect(listed.project).toMatchObject({ live: [], postfix: [] });
        expect((await readdir(join(folder, '.ruimte'))).some((name) => name.startsWith('templates.json.corrupt-'))).toBe(true);
    });
});

describe('writing', () => {
    test('a saved template gets an id and lands in a file only its owner reads', async () => {
        const { personal } = await store.list('c1', undefined);
        const saved = await store.save('c1', { scope: 'personal', revision: personal.revision, kind: 'live', template: log });

        expect(saved.template.id.length).toBeGreaterThan(0);
        expect(saved.revision).toBeGreaterThan(personal.revision);
        expect((await readJson(personalPath())).live).toEqual([{ id: saved.template.id, key: 'log', body: 'console.log($0);', languages: ['javascript'] }]);
        // Windows keeps no owner-only bits in a file's mode.
        if (process.platform !== 'win32') {
            expect((await stat(personalPath())).mode & 0o777).toBe(0o600);
        }
    });

    test('keys of a later release survive a write, in the place they were read', async () => {
        await writeJson(personalPath(), {
            version: 1,
            future: { a: 1 },
            live: [{ id: 'a', key: 'k', body: 'b', languages: ['php'], later: true }, { odd: 1 }],
            postfix: [],
            disabled: ['builtin.php.thr'],
            settings: { postfix: false, laterSwitch: 1 }
        });
        const { personal } = await store.list('c1', undefined);

        await store.save('c1', {
            scope: 'personal',
            revision: personal.revision,
            kind: 'live',
            template: { id: 'a', key: 'k2', body: 'b2', languages: ['php', 'php'] }
        });

        const file = await readJson(personalPath());

        expect(Object.keys(file)).toEqual(['version', 'future', 'live', 'postfix', 'disabled', 'settings']);
        expect(file.future).toEqual({ a: 1 });
        expect(file.live).toEqual([{ id: 'a', key: 'k2', body: 'b2', languages: ['php'], later: true }, { odd: 1 }]);
        expect(file.settings).toEqual({ postfix: false, laterSwitch: 1 });
    });

    test('a change drops the optional fields the template no longer has', async () => {
        const first = await store.save('c1', {
            scope: 'personal',
            revision: (await store.list('c1', undefined)).personal.revision,
            kind: 'live',
            template: { ...log, description: 'Prints', places: ['code', 'comment'] }
        });

        await store.save('c1', { scope: 'personal', revision: first.revision, kind: 'live', template: { ...log, id: first.template.id } });

        expect((await store.list('c1', undefined)).personal.live).toEqual([
            { id: first.template.id, key: 'log', body: 'console.log($0);', languages: ['javascript'] }
        ]);
    });

    test('a write against an older revision is a conflict and changes nothing', async () => {
        const { personal } = await store.list('c1', undefined);
        const saved = await store.save('c1', { scope: 'personal', revision: personal.revision, kind: 'live', template: log });
        const before = await readFile(personalPath(), 'utf8');

        await expect(store.save('c1', { scope: 'personal', revision: personal.revision, kind: 'live', template: log })).rejects.toMatchObject({
            code: 'rev-conflict'
        });
        await expect(store.remove('c1', { scope: 'personal', revision: personal.revision, kind: 'live', id: saved.template.id })).rejects.toMatchObject({
            code: 'rev-conflict'
        });
        expect(await readFile(personalPath(), 'utf8')).toBe(before);
    });

    test('a file edited since the last read makes the write a conflict that names the new revision', async () => {
        const { personal } = await store.list('c1', undefined);

        await writeJson(personalPath(), { version: 1, live: [{ id: 'hand', key: 'h', body: 'b', languages: ['php'] }] });

        await expect(store.save('c1', { scope: 'personal', revision: personal.revision, kind: 'live', template: log })).rejects.toMatchObject({
            code: 'rev-conflict'
        });

        const after = await store.list('c1', undefined);

        expect(after.personal.revision).toBeGreaterThan(personal.revision);
        expect(after.personal.live.map((template) => template.id)).toEqual(['hand']);
    });

    test('removing a template that is not there is refused', async () => {
        const { personal } = await store.list('c1', undefined);

        await expect(store.remove('c1', { scope: 'personal', revision: personal.revision, kind: 'postfix', id: 'nope' })).rejects.toMatchObject({
            code: 'template-not-found'
        });
    });

    test('a template that breaks a rule is refused', async () => {
        const { revision } = (await store.list('c1', undefined)).personal;
        const refused = (template: LiveTemplateInput) => store.save('c1', { scope: 'personal', revision, kind: 'live', template });

        await expect(refused({ ...log, key: 'a b' })).rejects.toMatchObject({ code: 'template-invalid' });
        await expect(refused({ ...log, key: 'k'.repeat(41) })).rejects.toMatchObject({ code: 'template-invalid' });
        await expect(refused({ ...log, body: 'x'.repeat(20_001) })).rejects.toMatchObject({ code: 'template-invalid' });
        await expect(refused({ ...log, body: '' })).rejects.toMatchObject({ code: 'template-invalid' });
        await expect(refused({ ...log, languages: [] })).rejects.toMatchObject({ code: 'template-invalid' });
        await expect(refused({ ...log, languages: ['cobol'] })).rejects.toMatchObject({ code: 'template-invalid' });
        await expect(refused({ ...log, places: ['margin'] })).rejects.toMatchObject({ code: 'template-invalid' });
        await expect(refused({ ...log, id: 'builtin.javascript.log' })).rejects.toMatchObject({ code: 'template-invalid' });
        await expect(
            store.save('c1', { scope: 'personal', revision, kind: 'postfix', template: { key: 'if.x', body: 'if ($EXPR) {}', languages: ['php'] } })
        ).rejects.toMatchObject({ code: 'template-invalid' });
        await expect(
            store.save('c1', { scope: 'personal', revision, kind: 'postfix', template: { key: 'if', body: 'if ($EXPR) {}', languages: ['css'] } })
        ).rejects.toMatchObject({ code: 'template-invalid' });
        expect(await fileExists(personalPath())).toBe(false);
    });

    test('configure replaces the disabled list and changes only the switches it names', async () => {
        const first = await store.configure({
            revision: (await store.list('c1', undefined)).personal.revision,
            disabled: ['builtin.php.thr'],
            settings: { postfix: false }
        });
        const second = await store.configure({ revision: first.revision, settings: { liveInCompletion: false } });

        expect(second.disabled).toEqual(['builtin.php.thr']);
        expect(second.settings).toEqual({ postfix: false, liveInCompletion: false });
        expect((await readJson(personalPath())).disabled).toEqual(['builtin.php.thr']);
    });
});

describe('a project', () => {
    test('shared templates are written to the project file for a client that holds the project', async () => {
        const { project } = await store.list('c1', 'p1');
        const saved = await store.save('c1', {
            scope: 'project',
            projectId: 'p1',
            revision: project!.revision,
            kind: 'postfix',
            template: { key: 'if', body: 'if ($EXPR) {}', languages: ['php'] }
        });

        expect(saved.kind).toBe('postfix');
        expect(Object.keys(await readJson(projectPath()))).toEqual(['version', 'live', 'postfix']);
        expect((await readJson(projectPath())).postfix).toHaveLength(1);
        expect(await fileExists(personalPath())).toBe(false);
    });

    test('a client that does not hold the project cannot write to it', async () => {
        await expect(store.save('c2', { scope: 'project', projectId: 'p1', revision: 0, kind: 'live', template: log })).rejects.toMatchObject({
            code: 'project-not-found'
        });
        await expect(store.save('c1', { scope: 'project', revision: 0, kind: 'live', template: log })).rejects.toMatchObject({ code: 'project-not-found' });
    });

    test('a save that changes nothing leaves the file, the revision and the clients alone', async () => {
        const { project } = await store.list('c1', 'p1');
        const first = await store.save('c1', { scope: 'project', projectId: 'p1', revision: project!.revision, kind: 'live', template: log });
        const text = await readFile(projectPath(), 'utf8');
        const heardBefore = templateEvents('c1').length;
        const again = await store.save('c1', {
            scope: 'project',
            projectId: 'p1',
            revision: first.revision,
            kind: 'live',
            template: { ...log, id: first.template.id }
        });

        expect(again.revision).toBe(first.revision);
        expect(await readFile(projectPath(), 'utf8')).toBe(text);
        expect(templateEvents('c1')).toHaveLength(heardBefore);
    });

    test('removing the last template of a project that never had a file writes none', async () => {
        const { project } = await store.list('c1', 'p1');

        await expect(store.remove('c1', { scope: 'project', projectId: 'p1', revision: project!.revision, kind: 'live', id: 'x' })).rejects.toMatchObject({
            code: 'template-not-found'
        });
        expect(await fileExists(projectPath())).toBe(false);
    });

    test('an edit made outside, such as a pull, reaches the clients that hold the project', async () => {
        const { project } = await store.list('c1', 'p1');

        await writeJson(projectPath(), { version: 1, live: [{ id: 'pulled', key: 'p', body: 'b', languages: ['html'] }], postfix: [] });
        fake.on(join(folder, '.ruimte')).emit('templates.json');
        await fake.settle();

        expect(templateEvents('c1')).toHaveLength(1);
        expect(templateEvents('c1')[0]).toMatchObject({ scope: 'project', projectId: 'p1', snapshot: { live: [{ id: 'pulled' }] } });
        expect(templateEvents('c1')[0]!.snapshot.revision).toBeGreaterThan(project!.revision);
        expect(templateEvents('c2')).toEqual([]);
    });

    test('letting the project go stops its watch, and the next read loads it again', async () => {
        await store.list('c1', 'p1');
        store.closeProject('p1');

        expect(fake.openOn(join(folder, '.ruimte'))).toEqual([]);

        await writeJson(projectPath(), { version: 1, live: [{ id: 'x', key: 'k', body: 'b', languages: ['css'] }], postfix: [] });

        expect((await store.list('c1', 'p1')).project?.live.map((template) => template.id)).toEqual(['x']);
    });
});

describe('a person', () => {
    test('an edit made outside reaches every client', async () => {
        await store.list('c1', undefined);
        await writeJson(personalPath(), { version: 1, live: [{ id: 'hand', key: 'h', body: 'b', languages: ['php'] }] });
        fake.on(home).emit('editor-templates.json');
        await fake.settle();

        expect(templateEvents('c1')).toHaveLength(1);
        expect(templateEvents('c2')).toHaveLength(1);
        expect(templateEvents('c2')[0]).toMatchObject({ scope: 'personal', snapshot: { live: [{ id: 'hand' }] } });
    });

    test('another file in the home does not count as an edit', async () => {
        await store.list('c1', undefined);
        fake.on(home).emit('endpoint.json');

        expect(fake.pending).toBe(0);
    });
});

describe('an agent', () => {
    const mine: LiveTemplateInput = { key: 'mine', body: 'console.log($0);', languages: ['javascript'] };

    test('adds a template to the person own set with a mark, and never against a taken key', async () => {
        const added = await store.addByAgent({ kind: 'live', template: mine }, 'chat-1', 'p1');

        expect(added.template).toMatchObject({ key: 'mine', addedBy: { kind: 'agent', chatId: 'chat-1', at: 1000 } });
        await expect(store.addByAgent({ kind: 'live', template: { ...mine, languages: ['typescript', 'javascript'] } }, 'chat-1', 'p1')).rejects.toMatchObject({
            code: 'template-key-taken'
        });
        await expect(store.checkAgentAdd({ kind: 'live', template: mine }, 'p1')).rejects.toMatchObject({ code: 'template-key-taken' });

        await store.addByAgent({ kind: 'live', template: { ...mine, languages: ['php'] } }, 'chat-1', 'p1');
        await store.addByAgent({ kind: 'postfix', template: { key: 'mine', body: 'console.log($EXPR);', languages: ['javascript'] } }, 'chat-1', 'p1');

        expect((await store.list('c1', undefined)).personal.live).toHaveLength(2);
        expect((await store.list('c1', undefined)).personal.postfix).toHaveLength(1);
    });

    test('adds new templates only', async () => {
        await expect(store.addByAgent({ kind: 'live', template: { ...mine, id: 'existing' } }, 'chat-1', 'p1')).rejects.toMatchObject({
            code: 'template-invalid'
        });
    });

    test('sees a template a person wrote by hand since the last read', async () => {
        await store.list('c1', undefined);
        await writeJson(personalPath(), { version: 1, live: [{ id: 'hand', key: 'mine', body: 'b', languages: ['javascript'] }] });

        await expect(store.addByAgent({ kind: 'live', template: mine }, 'chat-1', 'p1')).rejects.toMatchObject({ code: 'template-key-taken' });
    });

    test('keeps a template a person edits afterwards marked as the agent added it', async () => {
        const added = await store.addByAgent({ kind: 'live', template: mine }, 'chat-1', 'p1');
        const { revision } = (await store.list('c1', undefined)).personal;
        const edited = await store.save('c1', {
            scope: 'personal',
            revision,
            kind: 'live',
            template: { ...mine, id: added.template.id, body: 'console.info($0);' }
        });

        expect(edited.template).toMatchObject({ body: 'console.info($0);', addedBy: { chatId: 'chat-1' } });
    });
});

describe('the keys an agent cannot take', () => {
    const postfixLog = { key: 'log', body: '$EXPR.log()', languages: ['php'] };

    test('a built-in key of a language it shares, and a free one of another language', async () => {
        await expect(store.addByAgent({ kind: 'live', template: log }, 'chat-1', 'p1')).rejects.toMatchObject({ code: 'template-key-taken' });
        await expect(store.addByAgent({ kind: 'live', template: { ...log, languages: ['css'] } }, 'chat-1', 'p1')).resolves.toBeDefined();
        await expect(store.addByAgent({ kind: 'postfix', template: { ...postfixLog, languages: ['javascript'] } }, 'chat-1', 'p1')).rejects.toMatchObject({
            code: 'template-key-taken'
        });
        await expect(store.addByAgent({ kind: 'postfix', template: postfixLog }, 'chat-1', 'p1')).resolves.toBeDefined();
    });

    test('a built-in key the person switched off is free', async () => {
        const { personal } = await store.list('c1', undefined);
        await store.configure({ revision: personal.revision, disabled: ['builtin.javascript.log'] });

        await expect(store.addByAgent({ kind: 'live', template: log }, 'chat-1', 'p1')).resolves.toBeDefined();
    });

    test('a key of the project', async () => {
        await writeJson(projectPath(), { version: 1, live: [{ id: 'shared', key: 'mine', body: 'b', languages: ['typescript'] }] });
        const mine = { key: 'mine', body: 'b', languages: ['typescript', 'php'] };

        await expect(store.addByAgent({ kind: 'live', template: mine }, 'chat-1', 'p1')).rejects.toMatchObject({ code: 'template-key-taken' });
        await expect(store.addByAgent({ kind: 'live', template: { ...mine, languages: ['php'] } }, 'chat-1', 'p1')).resolves.toBeDefined();
    });

    test('a project file from a newer Ruimte does not stop an agent from adding to the person own set', async () => {
        await writeJson(projectPath(), { version: 2, live: [] });

        await expect(store.addByAgent({ kind: 'live', template: { key: 'mine', body: 'b', languages: ['php'] } }, 'chat-1', 'p1')).resolves.toBeDefined();
    });

    test('the list holds the three sources, and leaves out a built-in template that is switched off', async () => {
        await writeJson(personalPath(), { version: 1, live: [{ id: 'own', key: 'own', body: 'b', languages: ['php'] }], disabled: ['builtin.php.thr'] });
        await writeJson(projectPath(), { version: 1, postfix: [{ id: 'shared', key: 'shared', body: '$EXPR', languages: ['php'] }] });

        const rows = await store.listForAgent('p1');

        expect(rows.find((row) => row.id === 'builtin.javascript.log')).toMatchObject({ source: 'built-in', body: null, kind: 'live' });
        expect(rows.find((row) => row.id === 'own')).toMatchObject({ source: 'personal', body: 'b' });
        expect(rows.find((row) => row.id === 'shared')).toMatchObject({ source: 'project', kind: 'postfix' });
        expect(rows.some((row) => row.id === 'builtin.php.thr')).toBe(false);
    });
});
