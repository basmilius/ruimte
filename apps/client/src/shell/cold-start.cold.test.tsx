import { afterEach, beforeEach, expect, test } from 'bun:test';
import { behaviorOf } from '@/commands/behavior';
import type { DesktopBridge } from '@/desktop/bridge';
import { workspaceDialogs } from '@/registry/dialogs';
import { nodeKindRegistry } from '@/registry/node-kinds';
import { panelRegistry } from '@/registry/panels';
import { useWindow } from '@/workspace/window';
import { mount, type Mounted } from '../../testing/dom';
import { removeDesktop } from '../../testing/dom-helpers';
import { machineBridge } from '../../testing/machine-bridge';

/* The shell of an app that runs no machine, so nothing opens a workspace on its own. */
const bridge: DesktopBridge = {
    platform: 'darwin',
    pickFolder: async () => null,
    openExternal: async () => undefined,
    openGuestDevTools: () => undefined,
    requestKeepAwake: () => undefined,
    machine: machineBridge('none')
};

const scope = globalThis as unknown as { window: { ruimteDesktop?: DesktopBridge } };

let page: Mounted;

beforeEach(async () => {
    scope.window.ruimteDesktop = bridge;
    useWindow.getState().setBooting(false);
    page = mount();
    await page.renderApp();
});

afterEach(async () => {
    await page.unmount();
    removeDesktop();
});

test("a cold start screen has the window's commands and dialogs and nothing of a workspace before its chunk loads", () => {
    expect(behaviorOf('settings')).toBeDefined();
    expect(behaviorOf('measure-scene')).toBeDefined();
    expect(behaviorOf('add-chat')).toBeUndefined();
    expect(workspaceDialogs.all()).toEqual([]);
    expect(panelRegistry.all()).toEqual([]);
    expect(nodeKindRegistry.all()).toEqual([]);
});
