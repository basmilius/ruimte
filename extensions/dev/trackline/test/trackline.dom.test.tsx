import { describe, expect, test } from 'bun:test';
import { createTestHost, createTestServer, type TestHostOptions } from '@ruimte/extension/testing';
import type { TracklineServer } from '../server';

const KEY = 'trk_demo1234';
const ISSUE = { id: 'issue-1', title: 'TRK-101', extension: { type: 'issue', data: { key: 'TRK-101' } } };

interface Listed {
    list(): Promise<{ id: string; name: string }[]>;
    read(item: { id: string; name: string }): Promise<string>;
}

async function hostWith(options: TestHostOptions = {}, secrets: Record<string, string> = { key: KEY }) {
    const server = await createTestServer<TracklineServer>({ secrets });
    const host = await createTestHost({ ...options, answers: { server, ...options.answers } });

    return { host, server };
}

function defined<Definition>(host: Awaited<ReturnType<typeof createTestHost>>, kind: string, id: string): Definition {
    const found = host.definitions.find((each) => each.kind === kind && (each.definition.id === id || each.definition.name === id));

    if (found === undefined) {
        throw new Error(`No ${kind} ${id}`);
    }

    return found.definition as Definition;
}

describe('Trackline', () => {
    test('asks for the key, keeps it on the machine and counts the open issues on its panel', async () => {
        const { host, server } = await hostWith({ answers: { prompt: KEY } }, {});

        expect(host.panels.issues?.badge).toBeNull();
        expect(await host.run(host.action('connect'), 'commandPalette')).toEqual({ ok: true, value: undefined });

        expect(server.secrets).toEqual({ key: KEY });
        expect(host.notifications).toEqual([{ text: 'Connected as mira', tone: 'neutral' }]);
        expect(host.panels.issues?.badge).toBe('3');
    });

    test('shows the person why a key was refused', async () => {
        const { host, server } = await hostWith({ answers: { prompt: 'wrong' } }, {});

        expect(await host.run(host.action('connect'), 'commandPalette')).toMatchObject({ ok: false, error: { message: 'Trackline does not know this key' } });
        expect(server.secrets).toEqual({});
    });

    test('lists the open issues in its card, and all of them once a person asks for the closed ones', async () => {
        const { host } = await hostWith();
        const card = await host.render(host.card('open'));

        expect(card.text()).toBe('TRK-101 Sign-in loops back to the startTRK-102 Export a report as a spreadsheetTRK-103 Search is slow on large accounts');

        host.setSetting('mine', true);
        host.setSetting('closed', true);
        host.setSetting('order', 'key');
        await card.until(() => card.find('TRK-98 Dates show in the wrong time zone') !== null);

        expect(card.text()).toBe('TRK-98 Dates show in the wrong time zoneTRK-101 Sign-in loops back to the startTRK-103 Search is slow on large accounts');
    });

    test('says how to connect in its card and its panel, in the language of the person', async () => {
        const { host } = await hostWith({ language: 'nl' }, {});
        const card = await host.render(host.card('open'));
        const panel = await host.render(host.panel('issues'));

        expect(card.text()).toBe('Koppel je account met Connect Trackline in het opdrachtenpalet.');
        expect(panel.text()).toBe('Koppel je account met Connect Trackline in het opdrachtenpalet.');
    });

    test('opens its panel on the issue a person picked in the palette, and puts it on the canvas from there', async () => {
        const { host } = await hostWith();
        const source = defined<{ search(query: string): Promise<{ title: string; run(): void }[]> }>(host, 'paletteSource', 'issues');
        const rows = await source.search('sign-in');

        expect(rows.map((row) => row.title)).toEqual(['TRK-101 Sign-in loops back to the start']);
        expect(await source.search('s')).toEqual([]);

        rows[0]?.run();

        expect(host.panels.issues).toMatchObject({ open: true, params: { issue: 'TRK-101' } });

        const panel = await host.render(host.panel('issues'), { params: host.panels.issues?.params });

        expect(panel.text()).toContain('3 open issues');
        expect(panel.text()).toContain('After the second factor the page returns to the sign-in form.');

        await panel.click(panel.container.querySelector('button') as Element);

        expect(host.canvas.created()).toMatchObject([{ kind: 'extension', title: 'TRK-101', extension: { type: 'issue' } }]);
    });

    test('draws an issue as a node, with what an agent reads of it', async () => {
        const { host } = await hostWith({ project: { nodes: [ISSUE] } });
        const node = await host.render(host.node('issue'), { node: 'issue-1' });

        expect(node.text()).toContain('TRK-101: Sign-in loops back to the start');
        expect(node.text()).toContain('C-41 Renew the session before the second factor');
    });

    test('starts a chat beside an issue on a line to it, and remembers the chat', async () => {
        const { host, server } = await hostWith({ project: { nodes: [ISSUE, { id: 'note-1' }] } });
        const start = host.action('start-chat');

        expect(host.slot(start, 'nodeHeader', { node: { id: 'note-1' } })).toBeNull();
        expect(host.slot(start, 'nodeHeader', { node: { id: 'issue-1' } })).toMatchObject({ title: 'Start a chat' });
        expect(await host.run(start, 'nodeMenu', { node: { id: 'issue-1' } })).toEqual({ ok: true, value: undefined });

        const [chat] = host.canvas.created();

        expect(chat).toMatchObject({ kind: 'chat', title: 'TRK-101' });
        expect(host.canvas.links()).toEqual([{ from: 'issue-1', to: chat?.id }]);
        expect(host.canvas.revealed()).toEqual([chat?.id]);
        expect(server.storage).toEqual({ chats: { 'TRK-101': chat?.id as string } });
    });

    test('refuses to start a chat without agents.start, and shows the person why', async () => {
        const { host } = await hostWith({ project: { nodes: [ISSUE] }, manifest: { permissions: { 'canvas.write': 'Puts' } } });

        expect(await host.run(host.action('start-chat'), 'nodeHeader', { node: { id: 'issue-1' } })).toEqual({
            ok: false,
            error: { code: 'failed', message: 'Trackline did not ask for the permission agents.start in its manifest' }
        });
    });

    test('offers its issues after # in a chat, each as the text an agent reads', async () => {
        const { host } = await hostWith();
        const reference = defined<Listed>(host, 'reference', 'issues');
        const issues = await reference.list();

        expect(issues.map((issue) => issue.name)).toContain('TRK-102 Export a report as a spreadsheet');
        expect(await reference.read(issues[1] as { id: string; name: string })).toContain('Finance wants the monthly report');
    });

    test('puts an issue in the prompt after /issue, and says what is missing without a key', async () => {
        const { host } = await hostWith();
        const command = defined<{ run(args: string): Promise<string> }>(host, 'slashCommand', 'issue');

        expect(await command.run(' TRK-103 ')).toStartWith('Work on this issue.\n\nTRK-103: Search is slow on large accounts');
        expect(await command.run('')).toBe('Name an issue after /issue, such as TRK-101.');
        expect(await command.run('TRK-7')).toBe('(TRK-7 could not be read: Trackline has no issue TRK-7)');
    });

    test('adds the issue a person picks to the canvas, titled with its key', async () => {
        const { host } = await hostWith({ answers: { pick: 'TRK-102 Export a report as a spreadsheet' } });

        expect(await host.run(host.action('add'), 'canvasMenu')).toEqual({ ok: true, value: undefined });
        expect(host.canvas.created()).toMatchObject([{ title: 'TRK-102', extension: { type: 'issue' } }]);
    });
});
