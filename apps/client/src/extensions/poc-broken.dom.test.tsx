import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import type { ComponentType } from 'react';
import type { LoadedExtension } from '@/extensions/host/client-api';
import { useContributions } from '@/extensions/registry';
import { mount, until, type Mounted } from '../../testing/dom';
import { loadPoc } from '../../testing/poc';

const FAILED = 'could not be shown';

let extension: LoadedExtension;
let mounted: Mounted | null = null;

async function drawPanel(id: string): Promise<HTMLElement> {
    const Surface = useContributions.getState().panels.find((entry) => entry.kind === `extension:poc.broken/${id}`)?.component as ComponentType;

    mounted = mount();
    await mounted.render(<Surface />);

    return mounted.host;
}

beforeAll(async () => {
    extension = await loadPoc('broken');
});
// The stores outlive this file, and a surface left behind would draw over another file's window.
afterAll(() => extension.disposers.forEach((dispose) => dispose()));
afterEach(async () => {
    await mounted?.unmount();
    mounted = null;
});

describe('poc-broken', () => {
    test('is refused a component that is no lazy import', () => {
        expect(useContributions.getState().panels.some((entry) => entry.kind === 'extension:poc.broken/eager')).toBe(false);
    });

    test.each(['throws', 'missing'])('stays inside its rectangle when the panel %s fails', async (id) => {
        const host = await drawPanel(id);

        await until(() => host.textContent?.includes(FAILED) ?? false);
    });

    test('reads what its manifest asks for and nothing else', async () => {
        const refused = await drawPanel('permission');

        await until(() => refused.textContent?.includes(FAILED) ?? false);
        await mounted?.unmount();

        extension.manifest.permissions = { 'agents.status': 'For this test' };

        const allowed = await drawPanel('permission');

        await until(() => allowed.textContent?.includes('agents') ?? false);

        expect(allowed.textContent).not.toContain(FAILED);
    });
});
