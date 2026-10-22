import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act, useEffect } from 'react';
import type { ISearchOptions } from '@xterm/addon-search';
import type { TerminalViewHandle } from '@adecore/terminal';
import { EMPTY_FIND_QUERY, type FindQuery } from '@adecore/editor-react/models';
import { FindBar } from '@/find/FindBar';
import type { FindState } from '@/find/use-find';
import { mount, until, type Mounted } from '../../testing/dom';
import { useTerminalFind, type SearchLoader, type TerminalFind, type TerminalSearch } from './use-terminal-find';

class FakeSearch implements TerminalSearch {
    calls: string[] = [];
    options: Array<ISearchOptions | undefined> = [];
    disposed = 0;
    private listener: ((event: { resultIndex: number; resultCount: number }) => void) | null = null;

    findNext(term: string, options?: ISearchOptions): boolean {
        this.calls.push(`next:${term}`);
        this.options.push(options);
        return true;
    }

    findPrevious(term: string, options?: ISearchOptions): boolean {
        this.calls.push(`previous:${term}`);
        this.options.push(options);
        return true;
    }

    clearDecorations(): void {
        this.calls.push('clear');
    }

    onDidChangeResults(listener: (event: { resultIndex: number; resultCount: number }) => void): { dispose(): void } {
        this.listener = listener;
        return { dispose: () => (this.listener = null) };
    }

    dispose(): void {
        this.disposed += 1;
    }

    report(resultIndex: number, resultCount: number): void {
        this.listener?.({ resultIndex, resultCount });
    }
}

const FIND = {
    open: true,
    query: { ...EMPTY_FIND_QUERY, text: 'a' },
    summons: 0,
    replaceOpen: false,
    replaceText: '',
    preserveCase: false,
    setReplaceOpen: () => {},
    setPreserveCase: () => {},
    setReplaceText: () => {},
    setQuery: () => {},
    close: () => {}
} satisfies FindState;

let page: Mounted;
let addons: FakeSearch[];
let loads: number;
let latest: TerminalFind;
let open: boolean;
let query: FindQuery;
let generation: number;
let failing: boolean;

const view = { terminal: {} } as unknown as TerminalViewHandle;
const viewRef = { current: view };
const load: SearchLoader = async () => {
    loads += 1;
    if (failing) {
        throw new Error('chunk');
    }
    const addon = new FakeSearch();
    addons.push(addon);
    return addon;
};

function Probe() {
    const found = useTerminalFind({ open, query }, viewRef, generation, load);
    useEffect(() => {
        latest = found;
    });
    return null;
}

async function render(): Promise<void> {
    await page.render(<Probe />);
}

beforeEach(() => {
    page = mount();
    addons = [];
    loads = 0;
    open = false;
    query = EMPTY_FIND_QUERY;
    generation = 0;
    failing = false;
});

afterEach(async () => {
    await page.unmount();
});

describe('find in a terminal', () => {
    test('loads nothing while the bar is closed, and once when it opens', async () => {
        await render();
        expect(loads).toBe(0);

        open = true;
        await render();
        await until(() => addons.length === 1);
        await render();
        expect(loads).toBe(1);
    });

    test('a query searches incrementally with the decorations, and a step searches on from there', async () => {
        open = true;
        query = { ...EMPTY_FIND_QUERY, text: 'error', caseSensitive: true };
        await render();
        await until(() => addons.length === 1 && addons[0]!.calls.includes('next:error'));
        expect(addons[0]!.options[0]).toMatchObject({ incremental: true, caseSensitive: true });
        expect(addons[0]!.options[0]!.decorations).toBeDefined();

        await act(async () => latest.step(1));
        await act(async () => latest.step(-1));
        expect(addons[0]!.calls.slice(-2)).toEqual(['next:error', 'previous:error']);
        expect(addons[0]!.options[1]).toMatchObject({ incremental: false });
    });

    test('a result event reaches the bar as a count, and an empty query is nothing', async () => {
        open = true;
        query = { ...EMPTY_FIND_QUERY, text: 'a' };
        await render();
        await until(() => addons.length === 1);
        await act(async () => addons[0]!.report(1, 4));
        expect(latest).toMatchObject({ total: 4, current: 1, limited: false, invalid: false });

        await act(async () => addons[0]!.report(3, 1000));
        expect(latest).toMatchObject({ total: 1000, current: 3, limited: true });
        const bar = mount();
        await bar.render(<FindBar find={FIND} total={latest.total} current={latest.current} limited={latest.limited} onStep={() => {}} />);
        expect(bar.host.querySelector('[data-find-bar]')?.textContent).toContain('4 / 1,000+');
        await bar.unmount();

        query = EMPTY_FIND_QUERY;
        await render();
        expect(latest).toMatchObject({ total: 0, current: null });
        expect(addons[0]!.calls.at(-1)).toBe('clear');
    });

    test('an invalid regular expression is flagged and never asked of the addon', async () => {
        open = true;
        query = { ...EMPTY_FIND_QUERY, text: '(', regex: true };
        await render();
        await until(() => addons.length === 1);
        expect(latest.invalid).toBe(true);
        expect(addons[0]!.calls.filter((call) => call.startsWith('next'))).toEqual([]);
        await act(async () => latest.step(1));
        expect(addons[0]!.calls.filter((call) => call.startsWith('next'))).toEqual([]);
    });

    test('closing clears the decorations and disposes the addon', async () => {
        open = true;
        await render();
        await until(() => addons.length === 1);

        open = false;
        await render();
        expect(addons[0]!.calls).toContain('clear');
        expect(addons[0]!.disposed).toBe(1);
    });

    test('a rebuilt terminal gets an addon of its own and the old one goes', async () => {
        open = true;
        await render();
        await until(() => addons.length === 1);

        generation = 1;
        await render();
        await until(() => addons.length === 2);
        expect(addons[0]!.disposed).toBe(1);
        expect(addons[1]!.disposed).toBe(0);
    });

    test('an addon that cannot load leaves the bar with the reason', async () => {
        failing = true;
        open = true;
        await render();
        await until(() => latest.disabledReason !== null);
        expect(latest.disabledReason).toBe('Find is not available here');
    });
});
