import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import type { ProjectCanvasView, ProjectNode } from '@ruimte/contracts';
import { canvasOfNode } from '@/state/canvas';
import { useSettings } from '@/state/settings';
import { splitKey } from '@/state/keys';
import { textDrafts, useTextDrafts } from '@/state/text-drafts';
import { FakeMachine } from '../../testing/fake-machine';
import { until } from '../../testing/dom';
import { openCanvasPage, type CanvasPage } from '../../testing/canvas-page';

const TEXT = 'one\ntwo\n';
const FILE: ProjectNode = { id: 'notes', kind: 'file', title: 'notes.txt', path: 'notes.txt', x: 0, y: 0, w: 640, h: 480 };
const MAIN: ProjectCanvasView = { kind: 'canvas', id: 'main', name: 'Main', nodes: [FILE], texts: [], edges: [], layouts: [] };

let machine: FakeMachine;
let disk: { text: string; mtime: number };
let canvas: CanvasPage;

function editor(): HTMLTextAreaElement | null {
    return canvas.page.host.querySelector(`[data-node-id="${FILE.id}"] textarea`);
}

function plate(): Element | null {
    return (
        [...canvas.page.host.querySelectorAll(`[data-node-id="${FILE.id}"] [aria-hidden="true"]`)].find((element) => element.textContent === 'notes.txt') ??
        null
    );
}

function draftKey(): string | undefined {
    return Object.keys(useTextDrafts.getState().rows).find((key) => key.endsWith(`/${FILE.path}`));
}

async function zoomTo(zoom: number): Promise<void> {
    await act(async () => canvasOfNode(FILE.id)!.getState().setCamera({ x: 0, y: 0, zoom }));
}

async function chooseDistance(distance: 'standard' | 'far' | 'unlimited'): Promise<void> {
    await act(async () => useSettings.setState({ canvasRenderDistance: distance }));
}

beforeEach(async () => {
    machine = new FakeMachine();
    disk = { text: TEXT, mtime: 1 };
    machine.answer(
        'fs.read',
        () => ({ kind: 'text', text: disk.text, encoding: 'utf-8', size: disk.text.length, mtime: disk.mtime, language: 'text' }) as never
    );
    machine.answer('fs.write', ({ text }) => {
        disk = { text, mtime: disk.mtime + 1 };
        return { size: text.length, mtime: disk.mtime };
    });
    useSettings.setState({ canvasRenderDistance: 'standard' });
    canvas = await openCanvasPage(machine, [MAIN], FILE.id);
    await act(async () => canvasOfNode(FILE.id)!.getState().setViewport({ w: 1280, h: 800 }));
    await zoomTo(1);
});

afterEach(async () => {
    await canvas.close();
    useSettings.setState({ canvasRenderDistance: 'standard' });
});

describe('the render distance of a file on the canvas', () => {
    test('shows the plate at 0.3 on standard and the editor on far, and both from 0.4 up', async () => {
        await until(() => editor() !== null);

        await zoomTo(0.3);
        await until(() => plate() !== null && editor() === null);

        await chooseDistance('far');
        await until(() => editor() !== null && plate() === null);

        await zoomTo(0.15);
        await until(() => plate() !== null);

        await chooseDistance('unlimited');
        await until(() => editor() !== null);
    });

    test('keeps an unsaved edit through the switch from the editor to the plate and back', async () => {
        await until(() => editor() !== null);
        await until(() => draftKey() !== undefined);
        const { endpointId, id: path } = splitKey(draftKey()!);
        // Staged, so no save is scheduled and the draft is still unsaved when the editor goes.
        await act(async () => textDrafts.stage(endpointId, path, { text: TEXT, mtime: 1 }, 'edited\n'));

        await zoomTo(0.3);
        await until(() => plate() !== null && editor() === null);
        // The edit is either still held as a draft or was written as the editor went; it is never dropped.
        expect(textDrafts.draft(endpointId, path)?.text ?? disk.text).toBe('edited\n');

        await zoomTo(1);
        await until(() => editor() !== null);
        await until(() => textDrafts.draft(endpointId, path)?.text === 'edited\n');
    });
});
