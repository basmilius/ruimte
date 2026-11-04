import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { FakeWatch } from '@adecore/agents/testing';
import { tempHomes } from '../temp-home-test-helpers.ts';
import { TemplateStore } from '../templates/template-store.ts';
import type { CanvasHost } from './host.ts';
import { templateToolkit } from './template-tools.ts';
import { refusalCode, toolAnswer, toolCall } from './tool-test-helpers.ts';

const homes = tempHomes('ruimte-template-tool-');

let store: TemplateStore;
let host: CanvasHost;

beforeEach(async () => {
    const root = await homes();
    const folder = join(root, 'repo');

    await mkdir(folder, { recursive: true });

    store = new TemplateStore({
        path: join(root, 'editor-templates.json'),
        projects: { folderOf: () => folder, holdersOf: () => [] },
        seams: new FakeWatch(),
        now: () => 1000
    });
    host = {
        projects: { locate: (id: string) => (id === 'chat-1' ? { projectId: 'p1', folder, canvasId: null } : null) },
        templates: store
    } as unknown as CanvasHost;
});

afterEach(() => {
    store.closeAll();
});

async function call(name: string, input: Record<string, unknown>): Promise<string[]> {
    return (await toolAnswer(name, input, toolCall('chat-1', host))).lines;
}

const NEW = { key: 'tdd', body: "it('$1', () => {\n\t$0\n});", language: 'javascript,typescript' };

describe('the template tools', () => {
    test('adds a template to the person own set as sent, marked as the chat added it, and lists it', async () => {
        const [added] = await call('template_new', NEW);

        expect(added).toMatch(/^added\t[^\t]+\tlive\ttdd$/);

        const listed = await call('template_list', { language: 'typescript' });

        expect(listed).toContain(`template\t${added!.split('\t')[1]}\tlive\ttdd\tjavascript,typescript\tpersonal\t-`);

        const { personal } = await store.list('c1', undefined);

        expect(personal.live).toMatchObject([{ key: 'tdd', body: "it('$1', () => {\n\t$0\n});", addedBy: { kind: 'agent', chatId: 'chat-1' } }]);
    });

    test('lists the built-in templates with their source and no body in the json', async () => {
        const listed = await call('template_list', { language: 'php' });

        expect(listed).toContain('template\tbuiltin.php.thr\tlive\tthr\tphp\tbuilt-in\t-');

        const json = JSON.parse((await call('template_list', { json: true })).join('\n')) as { templates: { id: string; body: string | null }[] };

        expect(json.templates.find((template) => template.id === 'builtin.javascript.log')?.body).toBeNull();
    });

    test('refuses a key a built-in template has for the same language', async () => {
        const lines = await call('template_new', { key: 'log', body: 'x', language: 'javascript' });

        expect(refusalCode(lines)).toBe('template-key-taken');
        expect((await store.list('c1', undefined)).personal.live).toEqual([]);
    });

    test('refuses a template the check does not accept', async () => {
        expect(refusalCode(await call('template_new', { key: 'a b', body: 'x', language: 'php' }))).toBe('template-invalid');
        expect(refusalCode(await call('template_new', { key: 'x', body: 'x', language: 'php', expression: 'any' }))).toBe('template-invalid');
        expect(refusalCode(await call('template_new', { key: 'x', body: 'x', language: 'php', postfix: true, place: 'code' }))).toBe('template-invalid');
    });

    test('adds a postfix template', async () => {
        const [added] = await call('template_new', { key: 'dump', body: 'var_dump($EXPR);', language: 'php', postfix: true, expression: 'statement' });

        expect(added).toMatch(/\tpostfix\tdump$/);
        expect((await store.list('c1', undefined)).personal.postfix).toMatchObject([{ key: 'dump', expression: 'statement' }]);
    });

    test('a dry run checks and writes nothing', async () => {
        expect(await call('template_new', { ...NEW, dry_run: true })).toEqual(['dry-run\t-\tlive\ttdd']);
        expect((await store.list('c1', undefined)).personal.live).toEqual([]);
        expect(refusalCode(await call('template_new', { key: 'log', body: 'x', language: 'javascript', dry_run: true }))).toBe('template-key-taken');
    });

    test('has no tool to edit or remove', () => {
        expect(templateToolkit.tools.map((tool) => tool.name)).toEqual(['template_list', 'template_new']);
    });
});
