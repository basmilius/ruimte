import { afterEach, beforeEach, expect, test } from 'bun:test';
import { act } from 'react';
import { useChats } from '@adecore/agents-react/state';
import type { ProjectCanvasView } from '@ruimte/contracts';
import { onClientEvent } from '@/extensions/client-events';
import { focusedCanvas } from '@/state/canvas';
import { useDocument } from '@/state/document';
import { LOCAL_ENDPOINT_ID } from '@/state/endpoints';
import { endpointKey } from '@/state/keys';
import { FakeMachine } from '../../testing/fake-machine';
import { openCanvasPage, type CanvasPage } from '../../testing/canvas-page';
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

test('tells chat.turnFinished when a turn ends, and not when it waits on a person', () => {
    const key = endpointKey(LOCAL_ENDPOINT_ID, 'chat-1');
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
