import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { ComponentType } from 'react';
import { assertShortcut, matchesExtensionShortcut } from '@/extensions/action-shortcuts';
import { wantsLoading } from '@/extensions/activation';
import type { LoadedExtension } from '@/extensions/host/client-api';
import { useInstalledExtensions } from '@/extensions/loader';
import { useContributions } from '@/state/extension-registry';
import { useToasts } from '@/state/toasts';
import { mount, until } from '../../testing/dom';
import { connectFakeMachine, FakeMachine } from '../../testing/fake-machine';
import { loadProduct } from '../../testing/poc';

const ISSUES = [
    {
        key: 'TRK-101',
        title: 'Sign-in loops back to the start',
        state: 'open',
        assignee: 'mira',
        labels: ['bug'],
        body: 'After the second factor the page returns to the sign-in form.',
        chat: null,
        working: false
    },
    { key: 'TRK-102', title: 'Export a report as a spreadsheet', state: 'open', assignee: 'joss', labels: [], body: '', chat: null, working: false }
];
// What `server/` of Trackline answers, by its method.
const SERVER: Readonly<Record<string, (...args: string[]) => unknown>> = {
    account: () => 'mira',
    issues: () => ISSUES,
    text: (key) => `${key}: steps to reproduce are in Trackline.`
};

let extension: LoadedExtension;
let disconnect: () => void = () => undefined;

function panel() {
    return useContributions.getState().panels.find((each) => each.kind === 'extension:dev.trackline/issues');
}

const realFetch = globalThis.fetch;

beforeAll(async () => {
    const machine = new FakeMachine();

    // The panel's words come from the pack's `locales/`: answered from the folder, so no request to a page that
    // is not there decides how long the panel takes to draw.
    globalThis.fetch = (async (input: RequestInfo | URL) => {
        const name = /locales\/(\w+)\.json$/.exec(String(input))?.[1];

        if (name === undefined) {
            return realFetch(input);
        }

        return new Response(Bun.file(`${import.meta.dir}/../../../../extensions/dev/trackline/locales/${name}.json`));
    }) as typeof fetch;

    machine.answer('extension.call', async ({ method, args }) => ({ result: SERVER[method]?.(...(args as string[])) ?? null }));
    disconnect = connectFakeMachine(machine);
    extension = await loadProduct('trackline', 'Trackline');
});
afterAll(() => {
    globalThis.fetch = realFetch;
    extension.disposers.forEach((dispose) => dispose());
    disconnect();
});

describe('Trackline', () => {
    test('a slash command expands into the prompt, with what follows it and with what its server reads', async () => {
        const commands = useContributions.getState().slashCommands;

        expect(await commands.find((each) => each.name === 'triage')?.expand('the login loop')).toContain('as a Trackline issue');
        expect(await commands.find((each) => each.name === 'triage')?.expand('the login loop')).toContain('the login loop');
        expect(await commands.find((each) => each.name === 'issue')?.expand('TRK-101')).toContain('TRK-101: steps to reproduce are in Trackline.');
    });

    test('a reference comes down to text', async () => {
        const [reference] = useContributions.getState().references;
        const [issue] = (await reference?.list()) ?? [];

        expect(issue).toEqual({ id: 'TRK-101', name: 'TRK-101 Sign-in loops back to the start' });
        expect(await reference?.read(issue as { id: string; name: string })).toBe('TRK-101: steps to reproduce are in Trackline.');
    });

    test('offers a node, a card, a palette source and settings', () => {
        const state = useContributions.getState();

        expect(state.extensionNodes.map((entry) => entry.id)).toContain('dev.trackline/issue');
        expect(state.sidebarCards.map((entry) => entry.id)).toContain('dev.trackline/open');
        expect(state.extensionSchemas[0]?.fields.map((field) => field.key)).toEqual(['mine', 'closed', 'order']);
        expect(state.slotEntries.some((entry) => entry.id === 'dev.trackline/start-chat')).toBe(true);
    });

    test('a panel handle sets the badge, and its params reach the panel', async () => {
        await until(() => panel()?.badge?.() === '2');

        const { usePaletteHits } = await import('@/extensions/palette-sources');
        const hits: { title: string; run(): void }[] = [];

        function Rows() {
            hits.splice(0, hits.length, ...usePaletteHits('sign-in', true));

            return null;
        }

        const page = mount();

        await page.render(<Rows />);
        await until(() => hits.length > 0);

        expect(hits.map((hit) => hit.title)).toEqual(['TRK-101 Sign-in loops back to the start']);

        hits[0]?.run();
        // Loaded ahead, so the lazy panel resolves from the module cache: reading and compiling the file is
        // disk work, which no count of event-loop turns bounds on a busy machine.
        await import('../../../../extensions/dev/trackline/client/IssuesPanel');

        const Panel = panel()?.component as ComponentType;

        await page.render(<Panel />);
        await until(() => page.host.textContent?.includes('After the second factor the page returns to the sign-in form.') ?? false);
        await page.unmount();
    });
});

describe('a shortcut', () => {
    test('needs a modifier, as every shortcut in Ruimte', () => {
        expect(() => assertShortcut('k')).toThrow('no modifier');
        expect(() => assertShortcut('shift+k')).toThrow('no modifier');
        expect(() => assertShortcut('mod+k')).not.toThrow();
    });

    test('matches only its own keys', () => {
        const press = { key: 'k', metaKey: true, ctrlKey: false, shiftKey: false, altKey: true };

        expect(matchesExtensionShortcut('mod+alt+k', press, true)).toBe(true);
        expect(matchesExtensionShortcut('mod+k', press, true)).toBe(false);
        expect(matchesExtensionShortcut('mod+alt+k', press, false)).toBe(false);
    });
});

describe('activation', () => {
    test('loads with the app unless it names when', () => {
        expect(wantsLoading('acme.chat', undefined)).toBe(true);
        expect(wantsLoading('acme.chat', ['start'])).toBe(true);
        expect(wantsLoading('acme.chat', ['node:never-on-this-canvas'])).toBe(false);
    });
});

describe('settings in groups', () => {
    test('draws a titled card per group, and every key still reads by itself', async () => {
        const { SchemaSettings } = await import('@/extensions/SchemaSettings');
        const page = mount();

        await page.render(<SchemaSettings id="dev.trackline" />);

        const text = page.host.textContent ?? '';

        expect(text.indexOf('Issues')).toBeLessThan(text.indexOf('Only mine'));
        expect(text.indexOf('Only mine')).toBeLessThan(text.indexOf('Closed issues'));
        expect(text.indexOf('Closed issues')).toBeLessThan(text.indexOf('As Trackline lists them'));
        expect(useContributions.getState().extensionSchemas[0]?.groups.map((group) => group.title)).toEqual(['Issues', 'Order']);
        await page.unmount();
    });

    test('says when the browser refused a setting, and keeps the switch where it was', async () => {
        const { SchemaSettings } = await import('@/extensions/SchemaSettings');
        const { clickOn } = await import('../../testing/dom');
        const page = mount();
        const before = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
        // A browser whose storage is full, or turned off for the page.
        const full: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = {
            getItem: () => null,
            setItem: () => {
                throw new DOMException('The quota has been exceeded', 'QuotaExceededError');
            },
            removeItem: () => undefined
        };

        Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: full });
        useInstalledExtensions.setState({ installed: [{ manifest: extension.manifest, base: '/', enabled: true, hasClient: true, dev: false }] });

        try {
            await page.render(<SchemaSettings id="dev.trackline" />);
            await clickOn(page.host.querySelector('[role="switch"]'));

            expect(page.host.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('false');
            expect(useToasts.getState().toasts.map((toast) => [toast.title, toast.description])).toContainEqual([
                'Trackline could not keep what it stores',
                'Only mine'
            ]);
        } finally {
            await page.unmount();

            if (before !== undefined) {
                Object.defineProperty(globalThis, 'localStorage', before);
            }
        }
    });
});
