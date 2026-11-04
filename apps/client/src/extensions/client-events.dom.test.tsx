import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { useChats } from '@adecore/agents-react/state';
import type { ProjectCanvasView } from '@ruimte/contracts';
import { act } from 'react';
import { onClientEvent } from '@/extensions/client-events';
import { focusedCanvas } from '@/state/canvas';
import { useDocument } from '@/state/document';
import { currentEndpointId, endpointKey } from '@/state/keys';
import { openCanvasPage, type CanvasPage } from '../../testing/canvas-page';
import { FakeMachine } from '../../testing/fake-machine';
import { idleChatInfo } from '../../testing/project-fixtures';

const MAIN: ProjectCanvasView = { kind: 'canvas', id: 'main', name: 'Main', nodes: [], texts: [], edges: [], layouts: [] };
const OTHER: ProjectCanvasView = { ...MAIN, id: 'other', name: 'Other' };
let canvas: CanvasPage;

beforeEach(async () => {
    canvas = await openCanvasPage(new FakeMachine(), [MAIN, OTHER], (host) => host.querySelector('[data-canvas-surface]') !== null);
});

afterEach(() => canvas.close());

test('follows the canvas that has the focus when the focus moves to another cell of the grid', async () => {
    const added: string[] = [];
    const stop = onClientEvent('node.added', ({ node }) => {
        added.push(node.id);
    });

    await act(async () =>
        useDocument.setState({
            layout: {
                columns: [
                    { size: 0.5, cells: [{ viewId: MAIN.id, size: 1 }] },
                    { size: 0.5, cells: [{ viewId: OTHER.id, size: 1 }] }
                ],
                focus: { column: 0, cell: 0 }
            }
        })
    );
    await act(async () => useDocument.getState().focusTowards('right'));

    const nodeId = await act(async () => focusedCanvas().getState().addNode('note', { x: 0, y: 0 }));

    stop();

    expect(focusedCanvas().getState().viewId).toBe(OTHER.id);
    expect(added).toEqual([nodeId as string]);
});

test('tells nothing of a chat on another machine of the pool that this workspace does not show', () => {
    const statuses: string[] = [];
    const stop = onClientEvent('agent.status', ({ nodeId }) => void statuses.push(nodeId));
    const set = (key: string, id: string): void =>
        useChats.setState((state) => ({ statusByKey: { ...state.statusByKey, [key]: { info: { ...idleChatInfo(id), status: 'running' } } } }) as never);

    set(endpointKey('another-machine', 'chat-there'), 'chat-there');
    set(endpointKey(currentEndpointId(), 'chat-here'), 'chat-here');
    stop();
    useChats.setState({ statusByKey: {} });

    expect(statuses).toEqual(['chat-here']);
});

test('tells every listener, also after one that throws', () => {
    const heard: string[] = [];
    const quiet = spyOn(console, 'error').mockImplementation(() => undefined);
    const stops = [
        onClientEvent('view.changed', () => {
            throw new Error('Broken');
        }),
        onClientEvent('view.changed', ({ viewId }) => void heard.push(viewId ?? ''))
    ];

    try {
        useDocument.setState({ activeViewId: OTHER.id });
    } finally {
        stops.forEach((stop) => stop());
        quiet.mockRestore();
    }

    expect(heard).toEqual([OTHER.id]);
});

test('tells chat.turnFinished when a turn ends, and not when it waits on a person', () => {
    const key = endpointKey(currentEndpointId(), 'chat-1');
    const finished: string[] = [];
    const statuses: string[] = [];
    const set = (status: string, activeTurnId: string | null): void =>
        useChats.setState(
            (state) => ({ statusByKey: { ...state.statusByKey, [key]: { info: { ...idleChatInfo('chat-1'), status, activeTurnId } } } }) as never
        );
    const stops = [
        onClientEvent('chat.turnFinished', ({ chatId }) => void finished.push(chatId)),
        onClientEvent('agent.status', ({ status }) => void statuses.push(status))
    ];

    set('running', 'turn-1');
    set('needs-you', 'turn-1');
    set('running', 'turn-1');

    expect(finished).toEqual([]);

    set('idle', null);
    stops.forEach((stop) => stop());
    useChats.setState({ statusByKey: {} });

    expect(finished).toEqual(['chat-1']);
    expect(statuses).toHaveLength(4);
});
