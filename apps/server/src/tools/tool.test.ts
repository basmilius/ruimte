import { expect, test } from 'bun:test';
import { toolAnswer, toolCall } from './tool-test-helpers.ts';
import type { CanvasHost } from './host.ts';

// The input is checked before the tool reaches the host, so a host with nothing in it is enough.
const call = toolCall('term-1', {} as CanvasHost);

test('a view or a project of the wrong type is refused in words of its own, never in zod’s', async () => {
    expect((await toolAnswer('node_list', { view: 5 }, call)).lines[0]).toBe('refused\tbad-arguments\tview needs the id of a canvas');
    expect((await toolAnswer('node_list', { view: '' }, call)).lines[0]).toBe('refused\tbad-arguments\tview needs the id of a canvas');
    expect((await toolAnswer('node_list', { project: true }, call)).lines[0]).toBe(
        'refused\tbad-arguments\tproject needs the id of a project; project_list lists them'
    );
});
