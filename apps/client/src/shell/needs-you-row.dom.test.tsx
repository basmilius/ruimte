import { afterEach, describe, expect, test } from 'bun:test';
import { useChats } from '@adecore/agents-react/state';
import type { ProjectView } from '@ruimte/contracts';
import { act } from 'react';
import { mount, until, type Mounted } from '../../testing/dom';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';

const CHAT: ProjectView = { kind: 'chat', id: 'written', name: 'Vinyl notes', node: {} };

let workspace: FakeWorkspace;
let page: Mounted;

afterEach(async () => {
    await page.unmount();
    workspace.close();
});

describe('a chat that waits on you, in the sidebar', () => {
    test('stands in "Needs you" with its title once, and keeps its place in the list', async () => {
        workspace = await openFakeWorkspace(new FakeMachine(), { views: [CHAT] }, { activeViewId: CHAT.id, views: {} });
        page = mount();
        await page.renderApp();
        await act(async () => {
            useChats.setState((state) => ({
                statusByKey: Object.fromEntries(
                    Object.entries(state.statusByKey).map(([key, row]) => [key, { ...row, info: { ...row.info, status: 'needs-you' } }])
                )
            }));
        });
        await until(() => page.host.querySelector(`[data-sidebar-row="needs:${CHAT.id}"]`) !== null);

        const waiting = page.host.querySelector(`[data-sidebar-row="needs:${CHAT.id}"]`)!;
        expect(waiting.textContent!.split('Vinyl notes')).toHaveLength(2);
        expect(page.host.querySelector(`[data-sidebar-row="view:${CHAT.id}"]`)).not.toBeNull();
    });
});
