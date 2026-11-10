import { afterEach, expect, jest, test } from 'bun:test';
import { act } from 'react';
import { usePaletteHits } from '@/extensions/palette-sources';
import { contribute } from '@/state/extension-registry';
import { mount, type Mounted } from '../../testing/dom';

const stops: (() => void)[] = [];
let mounted: Mounted | null = null;

afterEach(async () => {
    jest.useRealTimers();
    await mounted?.unmount();
    mounted = null;
    stops.splice(0).forEach((stop) => stop());
});

function Rows({ query }: { query: string }) {
    const hits = usePaletteHits(query, true);

    return <p>{hits.map((hit) => hit.title).join(',') || 'nothing'}</p>;
}

test('shows none of the rows of a source that a new version replaced, also when the new one fails', async () => {
    const stopOld = contribute('paletteSources', {
        id: 'acme.notes/notes',
        title: 'Notes',
        search: async () => [{ id: 'one', title: 'Old note', run: () => undefined }]
    });

    jest.useFakeTimers();
    mounted = mount();
    await mounted.render(<Rows query="note" />);
    await act(async () => {
        jest.advanceTimersByTime(200);
    });

    expect(mounted.host.textContent).toBe('Old note');

    await act(async () => {
        stopOld();
        stops.push(
            contribute('paletteSources', {
                id: 'acme.notes/notes',
                title: 'Notes',
                search: async () => {
                    throw new Error('Broken');
                }
            })
        );
    });
    await act(async () => {
        jest.advanceTimersByTime(200);
    });

    expect(mounted.host.textContent).toBe('nothing');
});

test('shows the rows of a source that answered while another still searches, and adds those once it answers', async () => {
    let answerSlow = (): void => undefined;

    stops.push(
        contribute('paletteSources', {
            id: 'acme.slow/tickets',
            title: 'Tickets',
            search: () =>
                new Promise((resolve) => {
                    answerSlow = () => resolve([{ id: 'one', title: 'Ticket one', run: () => undefined }]);
                })
        }),
        contribute('paletteSources', {
            id: 'acme.fast/numbers',
            title: 'Numbers',
            search: async (query) => [{ id: query, title: `Number ${query}`, run: () => undefined }]
        })
    );
    jest.useFakeTimers();
    mounted = mount();
    await mounted.render(<Rows query="21" />);
    await act(async () => {
        jest.advanceTimersByTime(200);
    });

    expect(mounted.host.textContent).toBe('Number 21');

    await act(async () => answerSlow());

    expect(mounted.host.textContent).toBe('Ticket one,Number 21');
});
