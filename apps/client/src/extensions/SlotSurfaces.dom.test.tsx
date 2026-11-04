import { afterEach, describe, expect, test } from 'bun:test';
import { ContextMenu } from '@adecore/ui';
import { act } from 'react';
import { useActionRuns } from '@/extensions/action-runs';
import { contribute, type SlotEntry } from '@/extensions/registry';
import { useSlotOutlines } from '@/extensions/slot-outlines';
import { NodeHeaderSlot, SelectionBar, SlotMenuItems, SlotRow } from '@/extensions/SlotSurfaces';
import { focusedCanvas } from '@/state/canvas';
import type { CanvasNode } from '@/state/canvas-model';
import { useToasts } from '@/state/toasts';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';

let mounted: Mounted | null = null;
const disposers: (() => void)[] = [];

function add(overrides: Partial<SlotEntry>): void {
    disposers.push(
        contribute('slotEntries', { id: 'a/b', kind: 'action', title: 'Summarize', slots: { selectionBar: true }, run: () => undefined, ...overrides })
    );
}

function select(ids: string[]): void {
    focusedCanvas().setState({ selection: ids });
}

afterEach(async () => {
    await mounted?.unmount();
    mounted = null;
    disposers.splice(0).forEach((dispose) => dispose());
    select([]);
});

describe('a slot', () => {
    test('asks its function, with the context of that place, and hands the context to run', async () => {
        const ran: { nodes: { id: string }[] }[] = [];

        add({
            slots: { selectionBar: (context) => (context as { nodes: unknown[] }).nodes.length > 1 },
            run: (context) => void ran.push(context as { nodes: { id: string }[] })
        });
        add({ id: 'a/c', title: 'Elsewhere', slots: { nodeMenu: true } });
        mounted = mount();
        select(['one']);
        await mounted.render(<SelectionBar />);

        expect(mounted.host.textContent).not.toContain('Summarize');

        select(['one', 'two']);
        await until(() => mounted?.host.textContent?.includes('Summarize') ?? false);

        expect(mounted.host.textContent).not.toContain('Elsewhere');

        await clickOn(mounted.host.querySelector('button'));

        expect(ran[0]?.nodes.map((node) => node.id)).toEqual(['one', 'two']);
    });

    test('takes a title from the answer, and a slot that throws costs only itself', async () => {
        add({ slots: { viewToolbar: () => ({ title: 'Summarize this' }) } });
        add({
            id: 'a/d',
            title: 'Broken',
            slots: {
                viewToolbar: () => {
                    throw new Error('Oops');
                }
            }
        });
        mounted = mount();
        await mounted.render(<SlotRow place="viewToolbar" context={{}} words />);

        expect(mounted.host.textContent).toContain('Summarize this');
        expect(mounted.host.textContent).not.toContain('Broken');
    });

    test('a menu whose items throw costs only itself', async () => {
        const reported: string[] = [];

        add({ slots: { viewToolbar: true } });
        add({
            id: 'a/m',
            kind: 'menu',
            title: 'Broken menu',
            slots: { viewToolbar: true },
            items: () => {
                throw new Error('No items');
            },
            onFailure: (text) => reported.push(text)
        });
        mounted = mount();
        await mounted.render(<SlotRow place="viewToolbar" context={{}} words />);

        expect(mounted.host.textContent).toContain('Summarize');
        expect(reported).toContain('No items');
    });

    test('reads a node again when it changes, also where the host drew it a render ago', async () => {
        add({ slots: { nodeHeader: (context) => ({ title: `About ${(context as { node: { title: string } }).node.title}` }) } });
        focusedCanvas().setState({ nodes: { one: { id: 'one', kind: 'note', title: 'First', x: 0, y: 0, w: 100, h: 100 } as CanvasNode } });
        mounted = mount();
        await mounted.render(<NodeHeaderSlot nodeId="one" />);

        expect(mounted.host.querySelector('button[aria-label="About First"]')).not.toBeNull();

        await act(async () =>
            focusedCanvas().setState({ nodes: { one: { id: 'one', kind: 'note', title: 'Second', x: 0, y: 0, w: 100, h: 100 } as CanvasNode } })
        );

        expect(mounted.host.querySelector('button[aria-label="About Second"]')).not.toBeNull();
        focusedCanvas().setState({ nodes: {} });
    });

    test('tells a person when an action fails', async () => {
        const reported: string[] = [];

        add({
            run: async () => {
                throw new Error('No agent');
            },
            onFailure: (text) => reported.push(text)
        });
        mounted = mount();
        select(['one']);
        await mounted.render(<SelectionBar />);
        await clickOn(mounted.host.querySelector('button'));
        await until(() => reported.length > 0);

        expect(reported).toEqual(['No agent']);
        expect(JSON.stringify(useToasts.getState())).toContain('No agent');
    });
});

describe('every slot', () => {
    test('takes a widget in a menu too, and shows itself under dev', async () => {
        disposers.push(
            contribute('slotEntries', { id: 'a/w', kind: 'widget', title: 'w', slots: { canvasMenu: true }, component: () => <span>A widget</span> })
        );
        mounted = mount();
        await mounted.render(
            <ContextMenu.Root open>
                <ContextMenu.Popup>
                    <SlotMenuItems place="canvasMenu" context={{}} />
                </ContextMenu.Popup>
            </ContextMenu.Root>
        );

        expect(document.body.textContent).toContain('A widget');
    });

    test('names itself while the outlines are on, also with nothing in it', async () => {
        mounted = mount();
        await mounted.render(<SlotRow place="emptyCanvas" context={{ at: 1 }} />);

        expect(mounted.host.querySelector('[data-slot-outline]')).toBeNull();

        await act(async () => useSlotOutlines.setState({ on: true }));

        expect(mounted.host.querySelector('[data-slot-outline="emptyCanvas"]')).not.toBeNull();

        useSlotOutlines.setState({ on: false });
    });
});

describe('while an action runs', () => {
    test('its button cannot start it again on those nodes, the nodes say so, and it can be stopped', async () => {
        let started = 0;
        let signal: AbortSignal | null = null;

        add({
            run: (context) => {
                started += 1;
                signal = (context as { signal: AbortSignal }).signal;

                return new Promise((_done, fail) => {
                    signal?.addEventListener('abort', () => fail(new DOMException('Stopped', 'AbortError')));
                });
            }
        });
        mounted = mount();
        select(['one']);
        await mounted.render(
            <>
                <SelectionBar />
                <div data-testid="node">
                    <NodeHeaderSlot nodeId="one" />
                </div>
                <div data-testid="other">
                    <NodeHeaderSlot nodeId="two" />
                </div>
            </>
        );

        const button = mounted.host.querySelector('button') as HTMLButtonElement;

        await clickOn(button);
        await until(() => button.disabled);
        await clickOn(button);

        expect(started).toBe(1);
        expect(mounted.host.querySelector('[data-testid="node"] [data-run-sign]')).not.toBeNull();
        expect(mounted.host.querySelector('[data-testid="other"] [data-run-sign]')).toBeNull();

        await clickOn(mounted.host.querySelector('[data-testid="node"] [data-run-sign] button'));
        await until(() => useActionRuns.getState().runs.length === 0);
        await until(() => !button.disabled);

        expect((signal as AbortSignal | null)?.aborted).toBe(true);
        expect(JSON.stringify(useToasts.getState())).not.toContain('Stopped');
    });
});
