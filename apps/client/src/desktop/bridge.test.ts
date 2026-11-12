import { afterEach, describe, expect, test } from 'bun:test';
import { setWindowControlsSource, type WindowControlsSource } from '@adecore/ui';
import type { DesktopBridge, WindowControlsState } from '@ruimte/desktop-bridge';
import { connectWindowControls } from './bridge';

const scope = globalThis as unknown as { window?: { ruimteDesktop?: Partial<DesktopBridge> } };

const NO_SOURCE: WindowControlsSource = { inset: () => null, subscribe: () => () => {} };

/* A shell that has not answered yet, as on the first frame of a window. */
const silentShell = (platform: string) => {
    let push: (state: WindowControlsState) => void = () => {};

    scope.window = {
        ruimteDesktop: {
            platform,
            windowControls: () => new Promise<WindowControlsState>(() => {}),
            onWindowControls: (listener) => {
                push = listener;

                return () => {};
            }
        }
    };

    return { push: (state: WindowControlsState) => push(state) };
};

/* The source `connectWindowControls` handed `@adecore/ui`, which the first render reads synchronously. */
const connectedSource = (): WindowControlsSource => {
    connectWindowControls();

    return setWindowControlsSource(NO_SOURCE);
};

describe('the room for the window controls', () => {
    afterEach(() => {
        delete scope.window;
        setWindowControlsSource(NO_SOURCE);
    });

    test('clears the traffic lights on macOS before the shell answers', () => {
        silentShell('darwin');
        expect(connectedSource().inset()).toBe(86);
    });

    test('keeps no room before the shell answers where the controls sit elsewhere', () => {
        silentShell('win32');
        expect(connectedSource().inset()).toBeNull();
    });

    test('gives the room back once the shell says the lights are gone, as in fullscreen', () => {
        const shell = silentShell('darwin');
        const source = connectedSource();
        shell.push({ inset: null });
        expect(source.inset()).toBeNull();
    });
});
