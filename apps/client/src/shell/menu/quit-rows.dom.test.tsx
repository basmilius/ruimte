import { afterEach, expect, test } from 'bun:test';
import type { BackgroundServiceState, DesktopBridge } from '@ruimte/desktop-bridge';
import { menuItem } from '../../../testing/canvas-page';
import { clickOn, mount, openSubmenu } from '../../../testing/dom';
import { StationMenu } from './StationMenu';

const original = window.ruimteDesktop;

const SERVICE_STATE: BackgroundServiceState = { support: 'supported', keepRunning: false, owner: 'service', failure: null, linger: null };

interface Calls {
    quits: number;
    stops: number;
}

function installShell(options: { support?: BackgroundServiceState['support']; service?: boolean; quit?: boolean }): Calls {
    const calls: Calls = { quits: 0, stops: 0 };
    const state = { ...SERVICE_STATE, support: options.support ?? 'supported' };

    window.ruimteDesktop = {
        platform: 'win32',
        ...(options.quit === false
            ? {}
            : {
                  quit: () => {
                      calls.quits += 1;
                  }
              }),
        ...(options.service === false
            ? {}
            : {
                  backgroundService: {
                      state: async () => state,
                      onState: () => () => undefined,
                      stopMachine: () => {
                          calls.stops += 1;
                      }
                  }
              })
    } as unknown as DesktopBridge;

    return calls;
}

async function openFile(): Promise<void> {
    const page = mount();

    await page.render(<StationMenu variant="symbol" />);
    await clickOn(page.host.querySelector('button[aria-label="Menu"]'));
    await openSubmenu('File');
}

afterEach(() => {
    window.ruimteDesktop = original;
});

test('on Windows File ends with Quit Ruimte and Stop Machine and Quit, and each reaches its bridge method', async () => {
    const calls = installShell({});

    await openFile();

    expect(menuItem('Quit Ruimte')).not.toBeNull();
    expect(menuItem('Stop Machine and Quit')).not.toBeNull();

    await clickOn(menuItem('Stop Machine and Quit'));

    expect(calls).toEqual({ quits: 0, stops: 1 });

    await openFile();
    await clickOn(menuItem('Quit Ruimte'));

    expect(calls.quits).toBe(1);
});

test('a machine the app cannot run as a service leaves only Quit Ruimte', async () => {
    installShell({ support: 'dev' });

    await openFile();

    expect(menuItem('Quit Ruimte')).not.toBeNull();
    expect(menuItem('Stop Machine and Quit')).toBeNull();
});

test('without a machine of its own File shows only Quit Ruimte', async () => {
    installShell({ service: false });

    await openFile();

    expect(menuItem('Quit Ruimte')).not.toBeNull();
    expect(menuItem('Stop Machine and Quit')).toBeNull();
});

test('without a bridge File shows neither', async () => {
    window.ruimteDesktop = undefined;

    await openFile();

    expect(menuItem('Quit Ruimte')).toBeNull();
    expect(menuItem('Stop Machine and Quit')).toBeNull();
});

test('a shell from before the quit method shows no Quit Ruimte', async () => {
    installShell({ quit: false });

    await openFile();

    expect(menuItem('Quit Ruimte')).toBeNull();
});
