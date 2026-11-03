import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import type { ComponentType } from 'react';
import type { LoadedExtension } from '@/extensions/host/client-api';
import { useHostDialog } from '@/extensions/host/host-dialog-state';
import { HostDialogs, HostOverlays } from '@/extensions/host/host-dialogs';
import { runAction } from '@/extensions/action-runs';
import { useContributions } from '@/extensions/registry';
import { baseContext } from '@/extensions/slots';
import { useToasts } from '@/state/toasts';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';
import { loadPoc } from '../../testing/poc';

let extension: LoadedExtension;
let mounted: Mounted | null = null;

function action(id: string) {
    const entry = useContributions.getState().slotEntries.find((each) => each.id === `poc.workspace/${id}`);

    if (entry === undefined) {
        throw new Error(`No action ${id}`);
    }

    return entry;
}

const realFetch = globalThis.fetch;

beforeAll(async () => {
    // The panel's words come from the pack's `locales/`: answered from the folder, so no request to a page that
    // is not there decides how long the panel takes to draw.
    globalThis.fetch = (async (input: RequestInfo | URL) => {
        const name = /locales\/(\w+)\.json$/.exec(String(input))?.[1];

        if (name === undefined) {
            return realFetch(input);
        }

        return new Response(Bun.file(`${import.meta.dir}/../../../../extensions/poc/workspace/locales/${name}.json`));
    }) as typeof fetch;
    extension = await loadPoc('workspace');
});
afterAll(() => {
    globalThis.fetch = realFetch;
    extension.disposers.forEach((dispose) => dispose());
});
afterEach(async () => {
    await mounted?.unmount();
    mounted = null;
    useHostDialog.setState({ request: null });
});

describe('poc-workspace', () => {
    test('a panel handle changes the label, and its params reach the panel', async () => {
        const kind = 'extension:poc.workspace/workspace';
        const entry = () => useContributions.getState().panels.find((each) => each.kind === kind);

        await runAction(action('badge'), baseContext(), 'test');

        expect(entry()?.label()).toBe('POC workspace (3)');
        expect(entry()?.badge?.()).toBe('3');

        await runAction(action('open-panel'), baseContext(), 'commandPalette');
        // Loaded ahead, so the lazy panel resolves from the module cache: reading and compiling the file is
        // disk work, which no count of event-loop turns bounds on a busy machine.
        await import('../../../../extensions/poc/workspace/client/WorkspacePanel');
        mounted = mount();

        const Panel = entry()?.component as ComponentType;

        await mounted.render(<Panel />);
        await until(() => mounted?.host.textContent?.includes('Opened from: commandPalette') ?? false);
    });

    test('a write the manifest did not ask for is refused and reaches a person', async () => {
        const before = extension.manifest.permissions;

        extension.manifest.permissions = {};
        await runAction(action('stamp'), baseContext(), 'test');
        extension.manifest.permissions = before;

        expect(JSON.stringify(useToasts.getState())).toContain('canvas.write');
    });

    test('opens its own UI in an overlay, and hears what it closed with', async () => {
        mounted = mount();
        await mounted.render(<HostOverlays />);

        const pending = runAction(action('overlay'), baseContext(), 'test');

        await until(() => document.body.textContent?.includes('Which one?') ?? false);

        // In Ruimte's own format, around what the extension draws.
        expect(document.querySelector('[role="dialog"] header')?.textContent).toContain('POC overlay');

        await clickOn([...document.querySelectorAll('button')].find((button) => button.textContent === 'The second') ?? null);
        await pending;

        expect(JSON.stringify(useToasts.getState())).toContain('The second');
    });

    test('asks through the dialogs of Ruimte', async () => {
        mounted = mount();
        await mounted.render(<HostDialogs />);

        const pending = runAction(action('new-view'), baseContext(), 'test');

        await until(() => useHostDialog.getState().request !== null);

        expect(useHostDialog.getState().request?.title).toBe('Make a canvas');

        useHostDialog.getState().request?.answer(null);
        await pending;
    });
});
