import { afterEach, expect, test } from 'bun:test';
import type { DesktopBridge, MenuNode, MenuSpec } from '@ruimte/desktop-bridge';
import { mount } from '../../../testing/dom';
import { useNativeMenu } from './native-menu';

function Publisher() {
    useNativeMenu();

    return null;
}

interface Shell {
    menus: MenuSpec[];
    restarts: number;
    click(id: string): void;
}

function shell(): Shell {
    const state: Shell = { menus: [], restarts: 0, click: () => undefined };
    window.ruimteDesktop = {
        setMenu: (spec: MenuSpec) => {
            state.menus.push(spec);
        },
        onMenuCommand: (run: (id: string) => void) => {
            state.click = run;

            return () => undefined;
        },
        restartInSafeMode: async () => {
            state.restarts += 1;
        }
    } as unknown as DesktopBridge;

    return state;
}

function helpRow(spec: MenuSpec, label: string): MenuNode | undefined {
    const help = spec.menus.find((menu) => menu.label === 'Help');

    return help?.items.find((node) => node.kind === 'command' && node.label === label);
}

const original = window.ruimteDesktop;

afterEach(() => {
    window.ruimteDesktop = original;
    window.history.replaceState(null, '', '/');
});

test('Help restarts the desktop app without extensions', async () => {
    const desktop = shell();
    const page = mount();

    try {
        await page.render(<Publisher />);
        const row = helpRow(desktop.menus.at(-1)!, 'Restart Without Extensions');

        expect(row).toBeDefined();

        desktop.click(row!.kind === 'command' ? row!.id : '');

        expect(desktop.restarts).toBe(1);
    } finally {
        await page.unmount();
    }
});

test('a window already in safe mode offers no restart into it', async () => {
    window.history.replaceState(null, '', '/?safe-mode=1');
    const desktop = shell();
    const page = mount();

    try {
        await page.render(<Publisher />);

        expect(helpRow(desktop.menus.at(-1)!, 'Restart Without Extensions')).toBeUndefined();
    } finally {
        await page.unmount();
    }
});
