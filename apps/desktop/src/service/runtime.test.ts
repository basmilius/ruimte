import { describe, expect, test } from 'bun:test';
import { desktopRuntime } from './runtime';

describe('desktopRuntime', () => {
    test('the production app keeps the public daemon identity', () => {
        expect(
            desktopRuntime({
                packaged: true,
                productName: 'Ruimte',
                homeDirectory: '/Users/bas'
            })
        ).toEqual({
            defaultPort: 4210,
            daemonHome: '/Users/bas/.ruimte',
            daemonArgs: [],
            launchAgentLabel: 'app.ruimte.daemon',
            systemdUnitName: 'ruimte-daemon.service'
        });
    });

    test('the local Rust app shares data without sharing daemon ownership', () => {
        const regular = desktopRuntime({
            packaged: true,
            productName: 'Ruimte',
            homeDirectory: '/Users/bas'
        });
        const rust = desktopRuntime({
            packaged: true,
            productName: 'Ruimte Rust',
            homeDirectory: '/Users/bas'
        });

        expect(rust).toEqual({
            defaultPort: 4211,
            daemonHome: '/Users/bas/.ruimte',
            daemonArgs: ['--no-broker'],
            launchAgentLabel: 'app.ruimte.rust.daemon',
            systemdUnitName: 'ruimte-rust-daemon.service'
        });
        expect(rust.defaultPort).not.toBe(regular.defaultPort);
        expect(rust.launchAgentLabel).not.toBe(regular.launchAgentLabel);
        expect(rust.systemdUnitName).not.toBe(regular.systemdUnitName);
    });

    test('recognizes the packaged application name as well as its product name', () => {
        expect(desktopRuntime({ packaged: true, productName: 'ruimte-rust', homeDirectory: '/Users/bas' }).defaultPort).toBe(4211);
    });

    test('a checkout keeps its existing isolated defaults', () => {
        expect(
            desktopRuntime({
                packaged: false,
                productName: 'Ruimte',
                homeDirectory: '/home/bas'
            })
        ).toEqual({
            defaultPort: 4221,
            daemonHome: '/home/bas/.ruimte-rust-dev',
            daemonArgs: [],
            launchAgentLabel: 'app.ruimte.daemon',
            systemdUnitName: 'ruimte-daemon.service'
        });
    });
});
