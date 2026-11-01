import { afterEach, describe, expect, test } from 'bun:test';
import { CanvasActionBar } from '@/extensions/CanvasActionBar';
import { contribute } from '@/extensions/registry';
import { focusedCanvas } from '@/state/canvas';
import { useToasts } from '@/state/toasts';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';

let mounted: Mounted | null = null;
let dispose = (): void => undefined;

function select(ids: string[]): void {
    focusedCanvas().setState({ selection: ids });
}

afterEach(async () => {
    await mounted?.unmount();
    mounted = null;
    dispose();
    select([]);
});

describe('the bar of canvas actions', () => {
    test('shows only with a selection the action wants, and hands it that selection', async () => {
        const ran: (readonly string[])[] = [];

        dispose = contribute('canvasActions', { id: 'a/b', title: 'Summarize', when: (ids) => ids.length > 1, run: (ids) => void ran.push(ids) });
        mounted = mount();
        select(['one']);
        await mounted.render(<CanvasActionBar />);

        expect(mounted.host.textContent).not.toContain('Summarize');

        select(['one', 'two']);
        await until(() => mounted?.host.textContent?.includes('Summarize') ?? false);
        await clickOn(mounted.host.querySelector('button'));

        expect(ran).toEqual([['one', 'two']]);
    });

    test('tells a person when an action fails', async () => {
        dispose = contribute('canvasActions', {
            id: 'a/c',
            title: 'Fails',
            when: () => true,
            run: async () => {
                throw new Error('No agent');
            }
        });
        mounted = mount();
        select(['one']);
        await mounted.render(<CanvasActionBar />);
        await clickOn(mounted.host.querySelector('button'));
        await until(() => JSON.stringify(useToasts.getState()).includes('No agent'));

        expect(JSON.stringify(useToasts.getState())).toContain('Fails');
    });
});
