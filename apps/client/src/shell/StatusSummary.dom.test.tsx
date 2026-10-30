import { afterEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import type { ChatRequestSummary, ProjectCanvasView, ProjectView } from '@ruimte/contracts';
import { useChats } from '@adecore/agents-react/state';
import { useDocument } from '@/state/document';
import { endpointKey, splitKey } from '@/state/keys';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { mount, until, type Mounted } from '../../testing/dom';

const MAIN: ProjectCanvasView = {
    kind: 'canvas',
    id: 'main',
    name: 'Main',
    nodes: [{ id: 'asking', kind: 'chat', title: 'Asking', x: 0, y: 0, w: 560, h: 360 }],
    texts: [],
    edges: [],
    layouts: []
};
const LATER: ProjectView = { kind: 'chat', id: 'later', name: 'Later', node: {} };

let workspace: FakeWorkspace;
let page: Mounted;

function waitingCount(): string | null {
    return page.host.querySelector('button[aria-label="Next node that needs you, in any view"]')?.textContent ?? null;
}

afterEach(async () => {
    await page.unmount();
    workspace.close();
});

describe('the count of what needs you in the dock', () => {
    test('counts a node that comes into the project while no chat changed', async () => {
        workspace = await openFakeWorkspace(new FakeMachine(), { views: [MAIN] }, { activeViewId: MAIN.id, views: {} });
        page = mount();
        await page.renderApp();
        await until(() => Object.keys(useChats.getState().statusByKey).some((key) => splitKey(key).id === 'asking'));
        await act(async () => {
            useChats.setState((state) => {
                const [key, row] = Object.entries(state.statusByKey).find(([each]) => splitKey(each).id === 'asking')!;
                const waiting = { ...row, info: { ...row.info, status: 'needs-you' as const } };
                return { statusByKey: { ...state.statusByKey, [key]: waiting, [endpointKey(splitKey(key).endpointId, LATER.id)]: waiting } };
            });
        });
        await until(() => waitingCount() === '1');

        await act(async () => useDocument.setState((state) => ({ views: [...state.views, LATER] })));
        await until(() => waitingCount() === '2');
    });

    test('its tooltip says what each node asks, the one that waited longest first', async () => {
        workspace = await openFakeWorkspace(new FakeMachine(), { views: [MAIN, LATER] }, { activeViewId: MAIN.id, views: {} });
        page = mount();
        await page.renderApp();
        await until(() => Object.keys(useChats.getState().statusByKey).some((key) => splitKey(key).id === 'asking'));
        const question = (createdAt: number, text: string): ChatRequestSummary => ({
            requestId: text,
            itemId: text,
            kind: 'question',
            createdAt,
            question: { questions: [{ id: 'q', header: 'Question', question: text, choices: [], multiSelect: false }] }
        });
        await act(async () => {
            useChats.setState((state) => {
                const [key, row] = Object.entries(state.statusByKey).find(([each]) => splitKey(each).id === 'asking')!;
                const waiting = (requests: ChatRequestSummary[]) => ({ ...row, info: { ...row.info, status: 'needs-you' as const, requests } });
                return {
                    statusByKey: {
                        ...state.statusByKey,
                        [key]: waiting([question(2_000, 'Which database?')]),
                        [endpointKey(splitKey(key).endpointId, LATER.id)]: waiting([question(1_000, 'Ship it today?')])
                    }
                };
            });
        });
        await until(() => waitingCount() === '2');

        const button = page.host.querySelector<HTMLButtonElement>('button[aria-label="Next node that needs you, in any view"]')!;
        await act(async () => {
            button.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true, pointerType: 'mouse' }));
            button.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse' }));
            button.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
            button.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
        });
        await until(() => document.querySelector('[role="tooltip"]') !== null);
        const text = document.querySelector('[role="tooltip"]')!.textContent!;
        expect(text).toContain('Later: Asks: Ship it today?');
        expect(text).toContain('Asking: Asks: Which database?');
        expect(text.indexOf('Later:')).toBeLessThan(text.indexOf('Asking:'));
    });
});
