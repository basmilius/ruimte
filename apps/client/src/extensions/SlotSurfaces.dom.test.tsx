import { afterEach, describe, expect, test } from 'bun:test';
import { useActionRuns } from '@/extensions/action-runs';
import { contribute, type SlotEntry } from '@/extensions/registry';
import { NodeHeaderSlot, SelectionBar, SlotRow } from '@/extensions/SlotSurfaces';
import { focusedCanvas } from '@/state/canvas';
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
