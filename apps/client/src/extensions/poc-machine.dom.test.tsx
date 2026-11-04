import { afterAll, afterEach, beforeAll, describe, expect, jest, test } from 'bun:test';
import { act } from 'react';
import type { LoadedExtension } from '@/extensions/host/client-api';
import { usePaletteHits } from '@/extensions/palette-sources';
import { mount, type Mounted } from '../../testing/dom';
import { loadPoc } from '../../testing/poc';

let extension: LoadedExtension;
let mounted: Mounted | null = null;

function Rows({ query }: { query: string }) {
    const hits = usePaletteHits(query, true);

    return <p>{hits.map((hit) => hit.title).join(',') || 'nothing'}</p>;
}

async function textFor(query: string): Promise<string> {
    jest.useFakeTimers();
    mounted = mount();
    await mounted.render(<Rows query={query} />);

    await act(async () => {
        jest.advanceTimersByTime(200);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
    });

    return mounted.host.textContent ?? '';
}

beforeAll(async () => {
    extension = await loadPoc('machine');
});
afterAll(() => extension.disposers.forEach((dispose) => dispose()));
afterEach(async () => {
    jest.useRealTimers();
    await mounted?.unmount();
    mounted = null;
});

describe('poc-machine', () => {
    test('the palette shows what the extension finds, and nothing for what it does not', async () => {
        expect(await textFor('21')).toBe('Double 21');
        await mounted?.unmount();
        expect(await textFor('words')).toBe('nothing');
    });
});
