import { describe, expect, test } from 'bun:test';
import { commandLineServiceProgram, daemonServiceSpec, platformServiceManager, scheduledTaskFile, serviceLogFile } from './host';

describe('Ruimte service host', () => {
    test('names the installed service, its log and its program, and marks the daemon as owned by it', () => {
        const spec = daemonServiceSpec({
            platform: 'darwin',
            program: '/Apps/Ruimte/ruimte',
            args: ['--port', '4210'],
            home: '/Users/test',
            ruimteHome: '/Users/test/.ruimte',
            path: '/test/bin:/usr/bin'
        });
        expect(spec.label).toBe('app.ruimte.daemon');
        expect(spec.environment).toEqual({ RUIMTE_HOME: '/Users/test/.ruimte', PATH: '/test/bin:/usr/bin', RUIMTE_SERVICE: '1' });
        expect(spec.logFile).toBe('/Users/test/Library/Logs/Ruimte/daemon.log');
        expect(commandLineServiceProgram('/Users/test/.ruimte', 'darwin')).toBe('/Users/test/.ruimte/bin/ruimte');
    });

    test('a workgroup of any name is no authority: the system names it, and else the name stands alone', () => {
        const userOf = (authority: () => string | null, USERDOMAIN = 'OFFICE'): string | undefined =>
            daemonServiceSpec({
                platform: 'win32',
                program: 'ruimte.exe',
                args: [],
                home: 'C:\\Users\\test',
                ruimteHome: 'C:\\.ruimte',
                path: '',
                env: { LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local', COMPUTERNAME: 'DESKTOP-1', USERDOMAIN, USERNAME: 'test' },
                authority
            }).user;

        expect(userOf(() => 'DESKTOP-1')).toBe('DESKTOP-1\\test');
        expect(userOf(() => 'CORP')).toBe('CORP\\test');
        expect(userOf(() => null)).toBe('test');
        expect(
            userOf(() => {
                throw new Error('the computer knows its own name');
            }, 'desktop-1')
        ).toBe('desktop-1\\test');
    });

    test('a scheduled task for the person on Windows, with its files under the local app data', () => {
        const env = { LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local', COMPUTERNAME: 'DESKTOP-1', USERDOMAIN: 'DESKTOP-1', USERNAME: 'test' };
        const program = 'C:\\Users\\test\\AppData\\Local\\Programs\\Ruimte\\resources\\bin\\ruimte.exe';
        const spec = daemonServiceSpec({
            platform: 'win32',
            program,
            args: ['--port', '4210'],
            home: 'C:\\Users\\test',
            ruimteHome: 'C:\\Users\\test\\.ruimte',
            path: 'C:\\Windows\\System32;C:\\Program Files\\Git\\cmd',
            env
        });
        expect(spec.user).toBe('DESKTOP-1\\test');
        expect(spec.logFile).toBe('C:\\Users\\test\\AppData\\Local\\Ruimte\\logs\\daemon.log');
        expect(scheduledTaskFile('C:\\Users\\test', env)).toBe('C:\\Users\\test\\AppData\\Local\\Ruimte\\service\\app.ruimte.daemon.xml');
        expect(commandLineServiceProgram('C:\\Users\\test\\.ruimte', 'win32')).toBe('C:\\Users\\test\\.ruimte\\bin\\ruimte.exe');
    });

    test('falls back to the profile when Windows names no local app data', () => {
        expect(serviceLogFile('C:\\Users\\test', 'win32', {})).toBe('C:\\Users\\test\\AppData\\Local\\Ruimte\\logs\\daemon.log');
    });

    test('a Task Scheduler manager on Windows', () => {
        const manager = platformServiceManager('win32', { LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local' });
        expect(manager?.kind).toBe('task-scheduler');
        expect(manager?.path).toBe('C:\\Users\\test\\AppData\\Local\\Ruimte\\service\\app.ruimte.daemon.xml');
        expect(platformServiceManager('freebsd')).toBeNull();
    });
});
