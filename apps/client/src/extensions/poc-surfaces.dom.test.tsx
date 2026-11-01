import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import type { ComponentType } from 'react';
import { useContributions } from '@/extensions/registry';
import { mount, until, type Mounted } from '../../testing/dom';
import { loadPoc } from '../../testing/poc';

let mounted: Mounted | null = null;

async function draw(Surface: ComponentType): Promise<HTMLElement> {
    mounted = mount();
    await mounted.render(<Surface />);

    return mounted.host;
}

let disposers: (() => void)[] = [];

beforeAll(async () => {
    ({ disposers } = await loadPoc('surfaces'));
});
// The stores outlive this file, and a surface left behind would draw over another file's window.
afterAll(() => disposers.forEach((dispose) => dispose()));
afterEach(async () => {
    await mounted?.unmount();
    mounted = null;
});

describe('poc-surfaces', () => {
    test('contributes one of every surface', () => {
        const state = useContributions.getState();

        expect(state.panels.some((entry) => entry.kind === 'extension:poc.surfaces/panel')).toBe(true);
        expect(state.sidebarCards.map((entry) => entry.id)).toContain('poc.surfaces/card');
        expect(state.extensionNodes.map((entry) => entry.id)).toContain('poc.surfaces/counter');
        expect(state.extensionViews.map((entry) => entry.id)).toContain('poc.surfaces/view');
        expect(state.canvasLayers.map((entry) => entry.id)).toContain('poc.surfaces/overlay');
        expect(state.extensionSettings.map((entry) => entry.id)).toContain('poc.surfaces');
        expect(state.nodeMenuItems.map((entry) => entry.id)).toContain('poc.surfaces/id');
    });

    test('draws a panel with the hooks that read the app', async () => {
        const panel = useContributions.getState().panels.find((entry) => entry.kind === 'extension:poc.surfaces/panel');
        const host = await draw(panel?.component as ComponentType);

        await until(() => host.textContent?.includes('"nodes"') ?? false);

        expect(host.textContent).toContain('"selection"');
    });

    test('draws a card with the shared components and what it stored', async () => {
        const card = useContributions.getState().sidebarCards.find((entry) => entry.id === 'poc.surfaces/card');
        const host = await draw(card?.component as ComponentType);

        await until(() => host.textContent?.includes('Stored 0') ?? false);

        await host.querySelector('button')?.click();
        await until(() => host.textContent?.includes('Stored 1') ?? false);
        localStorage.clear();
    });
});
