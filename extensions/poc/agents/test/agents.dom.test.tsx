import { describe, expect, test } from 'bun:test';
import { createTestHost, type TestHostOptions } from '@ruimte/extension/testing';

const NODES: NonNullable<TestHostOptions['project']>['nodes'] = [
    { id: 'chat-1', kind: 'chat', title: 'Login', text: 'We fixed the login bug.', agent: { status: 'idle' } },
    { id: 'chat-2', kind: 'chat', title: 'Build', text: 'Still building.', agent: { status: 'needsYou' } },
    { id: 'note-1', kind: 'note', title: 'Plan', text: 'Ship on Friday.' }
];

function hostWith(options: TestHostOptions = {}) {
    return createTestHost({
        project: { nodes: NODES },
        answers: { 'agents.run': ({ context }) => ({ text: `${context?.length ?? 0} sources read` }) },
        ...options
    });
}

describe('POC agents', () => {
    test('summarizes the selection into a note beside it, linked to each source', async () => {
        const host = await hostWith({ selection: ['chat-1', 'note-1'] });
        const summarize = host.action('summarize');

        expect(await host.run(summarize, 'selectionBar')).toEqual({ ok: true, value: undefined });

        const [note] = host.canvas.notes();

        expect(note).toMatchObject({ title: 'Summary', text: '2 sources read' });
        expect(host.canvas.links()).toEqual([
            { from: 'chat-1', to: note?.id },
            { from: 'note-1', to: note?.id }
        ]);
        expect(host.canvas.revealed()).toEqual([note?.id]);
        expect(host.agents.calls[0]?.args).toEqual([
            { prompt: 'Summarize what follows in three lines.', context: ['# Login\nWe fixed the login bug.', '# Plan\nShip on Friday.'] }
        ]);
    });

    test('shows in the bar for a selection of several, and on a chat only once it is done', async () => {
        const host = await hostWith({ selection: ['chat-1'] });
        const summarize = host.action('summarize');

        expect(host.slot(summarize, 'selectionBar')).toBeNull();
        expect(host.slot(summarize, 'nodeHeader', { node: { id: 'chat-1' } })).toMatchObject({ title: 'Summarize' });
        expect(host.slot(summarize, 'nodeHeader', { node: { id: 'chat-2' } })).toBeNull();
        expect(host.slot(summarize, 'nodeMenu', { node: { id: 'chat-1' } })).toMatchObject({ title: 'Summarize this chat' });

        host.select(['chat-1', 'note-1']);

        expect(host.slot(summarize, 'nodeMenu', { node: { id: 'note-1' } })).toMatchObject({ title: 'Summarize 2 nodes' });
        expect(await host.run(summarize, 'nodeHeader', { node: { id: 'chat-2' } })).toMatchObject({ ok: false, error: { code: 'refused' } });
    });

    test('tells the person when there is no canvas to write the note on', async () => {
        const host = await hostWith({ project: { views: [{ id: 'docs', kind: 'extension' }], nodes: NODES }, selection: ['chat-1', 'note-1'] });

        await host.run(host.action('summarize'), 'commandPalette');

        expect(host.canvas.notes()).toEqual([]);
        expect(host.notifications).toEqual([{ text: 'No canvas to write on', tone: 'error' }]);
    });

    test('says why when the agent cannot answer', async () => {
        const host = await createTestHost({ project: { nodes: NODES }, selection: ['chat-1', 'note-1'] });

        await host.run(host.action('summarize'), 'selectionBar');

        expect(host.notifications).toEqual([{ text: 'Nothing answers agents.run in this test. Give it under answers', tone: 'error' }]);
    });

    test('lists the agents on the canvas in its card, and reveals the one a person clicks', async () => {
        const host = await hostWith();
        const card = await host.render(host.card('agents'));

        expect(card.text()).toBe('Login: idleBuild: needs you');

        await card.click('Build: needs you');

        expect(host.canvas.revealed()).toEqual(['chat-2']);
    });
});
