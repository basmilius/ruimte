import { afterEach, describe, expect, test } from 'bun:test';
import { ActionBar, NodeHeaderExtras } from '@/extensions/ActionSurfaces';
import { useActionRuns } from '@/extensions/action-runs';
import { contribute, type ActionContribution } from '@/extensions/registry';
import { focusedCanvas } from '@/state/canvas';
import { useToasts } from '@/state/toasts';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';

let mounted: Mounted | null = null;
let disposers: (() => void)[] = [];

function action(overrides: Partial<ActionContribution>): ActionContribution {
    return { id: 'a/b', title: 'Summarize', show: ['selectionBar'], when: () => true, run: () => undefined, ...overrides };
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

describe('the bar of actions', () => {
    test('shows only what asked for it, with a selection it wants, and hands over that selection', async () => {
        const ran: (readonly string[])[] = [];

        disposers.push(
            contribute('actions', action({ when: (ids) => ids.length > 1, run: (ids) => void ran.push(ids) })),
            contribute('actions', action({ id: 'a/c', title: 'Elsewhere', show: ['nodeMenu'] }))
        );
        mounted = mount();
        select(['one']);
        await mounted.render(<ActionBar />);

        expect(mounted.host.textContent).not.toContain('Summarize');

        select(['one', 'two']);
        await until(() => mounted?.host.textContent?.includes('Summarize') ?? false);

        expect(mounted.host.textContent).not.toContain('Elsewhere');

        await clickOn(mounted.host.querySelector('button'));

        expect(ran).toEqual([['one', 'two']]);
    });

    test('tells a person when an action fails', async () => {
        const reported: string[] = [];

        disposers.push(
            contribute(
                'actions',
                action({
                    run: async () => {
                        throw new Error('No agent');
                    },
                    onFailure: (text) => reported.push(text)
                })
            )
        );
        mounted = mount();
        select(['one']);
        await mounted.render(<ActionBar />);
        await clickOn(mounted.host.querySelector('button'));
        await until(() => reported.length > 0);

        expect(reported).toEqual(['No agent']);
        expect(JSON.stringify(useToasts.getState())).toContain('No agent');
    });
});

describe('while an action runs', () => {
    test('its button cannot start it twice and the nodes it is about say so, until it is done', async () => {
        const { promise, resolve } = Promise.withResolvers<void>();
        let started = 0;

        disposers.push(
            contribute(
                'actions',
                action({
                    run: () => {
                        started += 1;

                        return promise;
                    }
                })
            )
        );
        mounted = mount();
        select(['one']);
        await mounted.render(
            <>
                <ActionBar />
                <div data-testid="node">
                    <NodeHeaderExtras nodeId="one" />
                </div>
                <div data-testid="other">
                    <NodeHeaderExtras nodeId="two" />
                </div>
            </>
        );

        const button = mounted.host.querySelector('button') as HTMLButtonElement;

        await clickOn(button);
        await until(() => button.disabled);
        await clickOn(button);

        expect(started).toBe(1);
        expect(mounted.host.querySelector('[data-testid="node"]')?.childElementCount).toBe(1);
        expect(mounted.host.querySelector('[data-testid="other"]')?.childElementCount).toBe(0);

        resolve();
        await until(() => useActionRuns.getState().runs.length === 0);
        await until(() => !button.disabled);

        expect(mounted.host.querySelector('[data-testid="node"]')?.childElementCount).toBe(0);
    });
});
