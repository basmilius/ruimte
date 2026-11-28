import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { runAction } from '@/extensions/action-runs';
import type { LoadedExtension } from '@/extensions/host/client-api';
import { useHostDialog } from '@/extensions/host/host-dialog-state';
import { HostDialogs, HostOverlays } from '@/extensions/host/host-dialogs';
import { baseContext } from '@/extensions/slots';
import { useContributions } from '@/state/extension-registry';
import { useToasts } from '@/state/toasts';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';
import { loadProduct } from '../../testing/poc';

const NOTE = { id: 'note-1', kind: 'note', title: 'Ask finance about the columns' };

let extension: LoadedExtension;
let mounted: Mounted | null = null;

function action(id: string) {
    const entry = useContributions.getState().slotEntries.find((each) => each.id === `dev.boardwalk/${id}`);

    if (entry === undefined) {
        throw new Error(`No action ${id}`);
    }

    return entry;
}

beforeAll(async () => {
    extension = await loadProduct('boardwalk', 'Boardwalk');
});
afterAll(() => extension.disposers.forEach((dispose) => dispose()));
afterEach(async () => {
    await mounted?.unmount();
    mounted = null;
    useHostDialog.setState({ request: null });
});

describe('Boardwalk', () => {
    test('offers a node, a view, a canvas overlay, a template and viewers for its files', () => {
        const state = useContributions.getState();

        expect(state.extensionNodes.map((entry) => entry.id)).toContain('dev.boardwalk/card');
        expect(state.extensionViews.map((entry) => entry.id)).toContain('dev.boardwalk/board');
        expect(state.canvasLayers.map((entry) => entry.id)).toContain('dev.boardwalk/count');
        expect(state.slotEntries.some((entry) => entry.id === 'dev.boardwalk/template/sprint' && entry.addsNode === true)).toBe(true);
        expect(state.diffViewers[0]?.extensions).toEqual(['board']);
        expect(state.slotEntries.map((entry) => entry.id)).toEqual(expect.arrayContaining(['dev.boardwalk/add-card', 'dev.boardwalk/menu']));
    });

    test('a write the manifest did not ask for is refused and reaches a person', async () => {
        await runAction(action('to-card'), { ...baseContext(), node: NOTE }, 'test');

        expect(JSON.stringify(useToasts.getState())).toContain('canvas.write');
    });

    test('opens its own UI in an overlay, and hears what it closed with', async () => {
        const before = useToasts.getState().toasts.length;

        mounted = mount();
        await mounted.render(<HostOverlays />);

        const pending = runAction(action('add-card'), baseContext(), 'test');

        await until(() => document.querySelector('[role="dialog"] form') !== null);

        // In Ruimte's own format, around what the extension draws.
        expect(document.querySelector('[role="dialog"] header')?.textContent).toContain('New card');

        await clickOn([...document.querySelectorAll('button')].find((button) => button.textContent === 'Add the card') ?? null);
        await pending;

        // The card it closed with went on to the canvas, which this manifest may not write.
        expect(useToasts.getState().toasts.length).toBeGreaterThan(before);
        expect(document.querySelector('[role="dialog"] form')).toBeNull();
    });

    test('asks through the dialogs of Ruimte', async () => {
        mounted = mount();
        await mounted.render(<HostDialogs />);

        const pending = runAction(action('new-board'), baseContext(), 'test');

        await until(() => useHostDialog.getState().request !== null);

        expect(useHostDialog.getState().request?.title).toBe('Name the board');

        useHostDialog.getState().request?.answer(null);
        await pending;
    });
});
