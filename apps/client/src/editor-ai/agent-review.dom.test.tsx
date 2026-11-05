import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ProvenanceRun } from '@ruimte/contracts';
import { act } from 'react';
import { useSettings } from '@/state/settings';
import { textDrafts } from '@/state/text-drafts';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';
import { FakeMachine } from '../../testing/fake-machine';
import { claudeProvider } from '../../testing/fake-provider';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';

const VIEW = { kind: 'file', id: 'greet-view', name: 'greet.ts', path: 'greet.ts' };
const PATH = '/work/atlas/greet.ts';
const TEXT = 'export function greet(name) {\n    return "hi " + name;\n}\n';

/* Claude rewrote the line that greets, in the first turn of its chat. */
const RUN: ProvenanceRun = {
    id: 'run-1',
    chatId: 'chat-writer',
    turnId: 'turn-1',
    turn: 1,
    provider: 'claude',
    at: 1,
    promptExcerpt: 'say hi',
    start: 2,
    end: 2,
    before: ['    return "hello " + name;'],
    review: 'pending',
    via: 'tool'
};

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;
let previousMode: ReturnType<typeof useSettings.getState>['aiAgentChanges'];

function input(): HTMLTextAreaElement | null {
    return page.host.querySelector('textarea');
}

function button(label: string): HTMLButtonElement | null {
    return [...page.host.querySelectorAll('button')].find((element) => element.textContent?.trim() === label) ?? null;
}

async function openReview(): Promise<void> {
    await page.renderApp();
    await until(() => input() !== null);
    await act(async () => input()!.focus());
    await until(() => button('Keep') !== null);
}

beforeEach(async () => {
    previousMode = useSettings.getState().aiAgentChanges;
    useSettings.setState({ aiAgentChanges: 'review' });
    machine = new FakeMachine();
    machine.answer('provider.list', () => ({ providers: [claudeProvider()] }) as never);
    machine.answer('fs.read', () => ({ kind: 'text', text: TEXT, encoding: 'utf-8', size: TEXT.length, mtime: 1, language: 'typescript' }) as never);
    machine.answer('provenance.read', () => ({ mtime: 1, lines: 3, runs: [RUN] }));
    machine.answer('provenance.review', ({ runIds }) => ({ updated: runIds.length }));
    workspace = await openFakeWorkspace(machine, { views: [VIEW] } as never, { activeViewId: VIEW.id, views: {} });
    page = mount();
});

afterEach(async () => {
    await page.unmount();
    workspace.close();
    useSettings.setState({ aiAgentChanges: previousMode });
    // An unsaved draft outlives the window that drew it, and the next test opens the same file.
    textDrafts.discard('fake-machine', PATH);
});

describe('reviewing what an agent wrote in a file', () => {
    test('names the change and who made it', async () => {
        await openReview();

        expect(page.host.textContent).toContain('Turn 1 in Claude Code changed 1 place');
        expect(button('Undo')).not.toBeNull();
    });

    test('Keep marks the change kept on the machine and leaves the text alone', async () => {
        await openReview();

        await clickOn(button('Keep'));
        await until(() => machine.requests('provenance.review').length > 0);

        expect(machine.requests('provenance.review')).toEqual([{ projectId: 'project-atlas', path: PATH, runIds: ['run-1'], state: 'kept' }]);
        expect(input()!.value).toBe(TEXT);
    });

    test('Undo puts back the lines the agent replaced and marks the change undone', async () => {
        await openReview();

        await clickOn(button('Undo'));
        await until(() => machine.requests('provenance.review').length > 0);

        expect(machine.requests('provenance.review')).toEqual([{ projectId: 'project-atlas', path: PATH, runIds: ['run-1'], state: 'undone' }]);
        expect(input()!.value).toBe('export function greet(name) {\n    return "hello " + name;\n}\n');
    });
});
