import { afterEach, expect, test } from 'bun:test';
import './dom';
import { writeClientLocal } from '@/project/client-local';
import { useDocument } from '@/state/document';
import { FakeMachine } from './fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from './fake-workspace';

const VIEWS = [
    { kind: 'canvas', id: 'first', name: 'First', nodes: [], texts: [], edges: [], layouts: [] },
    { kind: 'canvas', id: 'second', name: 'Second', nodes: [], texts: [], edges: [], layouts: [] }
];

let workspace: FakeWorkspace | null = null;

afterEach(() => {
    workspace?.close();
    workspace = null;
});

test('a fixture opens on what it asks for, whatever an earlier test left in this page', async () => {
    writeClientLocal(localStorage, 'fake-machine', 'project-atlas', { activeViewId: 'first', views: {} });
    workspace = await openFakeWorkspace(new FakeMachine(), { views: VIEWS } as never, { activeViewId: 'second', views: {} });
    expect(useDocument.getState().activeViewId).toBe('second');
});
