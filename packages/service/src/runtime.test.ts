import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MACHINE_SHUTDOWN_PATH } from '@ruimte/contracts';
import { isAppRedirectUri } from '@ruimte/pulsar';
import { LOCAL_KEY_FILE } from './home';
import {
    BUILD_FILE,
    CLIENT_DEV_PORT,
    DEFAULT_PORT,
    DEV_HOME_FOLDER_NAME,
    DEV_PORT,
    devRuimteHome,
    HOME_FOLDER_NAME,
    ruimteHome,
    SERVICE_LABEL
} from './runtime';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

function read(path: string): string {
    return readFileSync(join(ROOT, path), 'utf8');
}

function scriptsOf(path: string): Record<string, string> {
    return (JSON.parse(read(path)) as { scripts?: Record<string, string> }).scripts ?? {};
}

describe('the home of a daemon', () => {
    test('is $RUIMTE_HOME, else a folder in the home of the account', () => {
        expect(ruimteHome({ RUIMTE_HOME: '/data/ruimte' }, '/Users/test')).toBe('/data/ruimte');
        expect(ruimteHome({}, '/Users/test')).toBe(join('/Users/test', '.ruimte'));
    });

    test('is $RUIMTE_DEV_HOME for a checkout, and an empty variable is none', () => {
        expect(devRuimteHome({ RUIMTE_DEV_HOME: '/data/dev' }, '/Users/test')).toBe('/data/dev');
        expect(devRuimteHome({ RUIMTE_DEV_HOME: '' }, '/Users/test')).toBe(join('/Users/test', '.ruimte-dev'));
        expect(devRuimteHome({}, '/Users/test')).toBe(join('/Users/test', '.ruimte-dev'));
    });
});

// Places that cannot import the constants hold a copy; each reads here what the copy has to say.
describe('the copies of the runtime constants', () => {
    test('the root and desktop scripts start the client on its dev port', () => {
        expect(scriptsOf('package.json')['dev:client:built']).toContain(`--port ${CLIENT_DEV_PORT} `);
        for (const name of ['dev', 'smoke']) {
            expect(scriptsOf('apps/desktop/package.json')[name]).toContain(`RUIMTE_DEV_URL=http://localhost:${CLIENT_DEV_PORT} `);
        }
    });

    test('the address book lets a sign-in return to the client dev port', () => {
        expect(isAppRedirectUri(`http://localhost:${CLIENT_DEV_PORT}/pulsar/callback`)).toBe(true);
    });

    test('every extension that develops against a checkout uses its port and home', () => {
        const manifests = [...new Bun.Glob('extensions/**/package.json').scanSync({ cwd: ROOT })].filter((path) => !path.includes('node_modules'));
        const dev = manifests.map((path) => scriptsOf(path).dev).filter((script) => script?.includes('extension dev'));
        expect(dev.length).toBeGreaterThan(0);
        for (const script of dev) {
            expect(script).toContain(`--port ${DEV_PORT}`);
            expect(script).toContain(`RUIMTE_HOME=$HOME/${DEV_HOME_FOLDER_NAME} `);
        }
    });

    test('the Windows installer finds the service, the secret and the daemon as the daemon names them', () => {
        const stop = read('apps/desktop/build/stop-machine.ps1');
        expect(stop).toContain(`$taskName = '${SERVICE_LABEL}'`);
        expect(stop).toContain(`$defaultPort = ${DEFAULT_PORT}\n`);
        expect(stop).toContain(`'${HOME_FOLDER_NAME}'`);
        expect(stop).toContain(`'${LOCAL_KEY_FILE}'`);
        expect(stop).toContain(MACHINE_SHUTDOWN_PATH);
        expect(read('apps/desktop/build/installer.nsh')).toContain(`!define MACHINE_TASK "${SERVICE_LABEL}"`);
    });

    test('the npm packages lay out the build file under its name', () => {
        expect(read('packages/npm/scripts/build.ts')).toContain(`'${BUILD_FILE}'`);
    });
});
