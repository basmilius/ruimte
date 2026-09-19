import { describe, expect, test } from 'bun:test';
import { daemonServiceSpec, platformServiceManager, serviceDefinition, serviceLogFile } from './platform';

const SERVICE = { program: '/opt/ruimte/bin/ruimte', args: ['--port', '4210'], home: '/home/ada', ruimteHome: '/home/ada/.ruimte', path: '/usr/bin:/bin' };

describe('platformServiceManager', () => {
    test('there is none where there is no background service', () => {
        expect(platformServiceManager('win32')).toBeNull();
        expect(platformServiceManager('freebsd')).toBeNull();
    });

    test('macOS and Linux each get theirs', () => {
        expect(platformServiceManager('darwin')?.path).toContain('LaunchAgents');
        expect(platformServiceManager('linux')?.path).toContain('systemd');
    });
});

describe('daemonServiceSpec', () => {
    test('says which home the daemon runs with and that something restarts it', () => {
        expect(daemonServiceSpec(SERVICE).environment).toEqual({ RUIMTE_HOME: '/home/ada/.ruimte', PATH: '/usr/bin:/bin', RUIMTE_SERVICE: '1' });
    });

    test('the shell and the command write the same log file', () => {
        expect(daemonServiceSpec(SERVICE).logFile).toBe(serviceLogFile('/home/ada'));
    });
});

describe('serviceDefinition', () => {
    test('a plist on macOS and a unit anywhere else it runs', () => {
        expect(serviceDefinition('darwin', daemonServiceSpec(SERVICE))).toContain('<plist version="1.0">');
        expect(serviceDefinition('linux', daemonServiceSpec(SERVICE))).toContain('[Service]');
    });
});
