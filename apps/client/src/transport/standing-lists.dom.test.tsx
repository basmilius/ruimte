import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { RequestType } from '@ruimte/contracts';
import { act } from 'react';
import { mount, until, type Mounted } from '../../testing/dom';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';

const CANVAS = { kind: 'canvas', id: 'canvas', name: 'Canvas', nodes: [], edges: [], texts: [], groups: [] };

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

function asked(type: RequestType): number {
    return machine.requests(type).length;
}

/* Until the machine hears nothing new for a while, counted in turns of the event loop rather than by a clock. */
async function quiet(): Promise<void> {
    let seen = -1;
    for (let round = 0; round < 50 && seen !== machine.sent.length; round++) {
        seen = machine.sent.length;
        for (let i = 0; i < 5; i++) {
            await until(() => true);
        }
    }
}

beforeEach(async () => {
    machine = new FakeMachine();
    workspace = await openFakeWorkspace(machine, { views: [CANVAS] } as never, { activeViewId: CANVAS.id, views: {} });
});

afterEach(async () => {
    await page.unmount();
    workspace.close();
});

describe('the standing lists of a machine', () => {
    test('opening a project asks for no list the clients of its machine did not already ask the socket for', async () => {
        // The clients of the machine were built on an open socket, and asked it in one turn.
        expect([asked('session.list'), asked('chat.list')]).toEqual([1, 1]);

        page = mount();
        await page.renderApp();
        await quiet();
        // The sidebar the window draws then asks for its own, once.
        expect(asked('project.sidebar')).toBe(1);
        expect([asked('session.list'), asked('chat.list')]).toEqual([2, 2]);
    });

    test('a socket that comes back is asked for each list once, whoever listens on it', async () => {
        page = mount();
        await page.renderApp();
        await quiet();
        machine.sent.length = 0;

        await act(async () => machine.drop());
        await quiet();
        await act(async () => machine.reopen());
        await quiet();
        expect(asked('project.sidebar')).toBe(1);
        expect([asked('session.list'), asked('chat.list')]).toEqual([1, 1]);
    });
});
