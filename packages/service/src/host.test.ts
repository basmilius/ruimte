import { describe, expect, test } from 'bun:test';
import { definitionRunsProgram, launchAgentPlist, scheduledTask, systemdUnit } from '@adecore/service';
import { commandLineServiceProgram, daemonServiceSpec, platformServiceManager, scheduledTaskFile, serviceLogFile } from './host';

describe('Ruimte service host', () => {
    test('names the installed service, its log and its program, and marks the daemon as owned by it', () => {
        const spec = daemonServiceSpec({
            platform: 'darwin',
            program: '/Apps/Ruimte & Tools/ruimte',
            args: ['--port', '4210'],
            home: '/Users/test',
            ruimteHome: '/Users/test/.ruimte',
            path: '/test/bin:/usr/bin'
        });
        expect(spec.label).toBe('app.ruimte.daemon');
        expect(spec.environment).toEqual({ RUIMTE_HOME: '/Users/test/.ruimte', PATH: '/test/bin:/usr/bin', RUIMTE_SERVICE: '1' });
        expect(spec.logFile).toBe('/Users/test/Library/Logs/Ruimte/daemon.log');
        const plist = launchAgentPlist(spec);
        expect(plist).toContain('<string>app.ruimte.daemon</string>');
        expect(plist).toContain('<string>/Apps/Ruimte &amp; Tools/ruimte</string>');
        expect(plist).toContain('<string>/Users/test/Library/Logs/Ruimte/daemon.log</string>');
        expect(plist).toContain('<key>RUIMTE_SERVICE</key>');
        const unit = systemdUnit(spec);
        expect(unit).toContain('Description=Ruimte machine');
        expect(unit).toContain('Environment="RUIMTE_SERVICE=1"');
        expect(unit).toContain('WorkingDirectory=/Users/test');
        expect(commandLineServiceProgram('/Users/test/.ruimte', 'darwin')).toBe('/Users/test/.ruimte/bin/ruimte');
    });

    test('a workgroup is no authority for the account of a scheduled task', () => {
        const env = { LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local', USERDOMAIN: 'WORKGROUP', USERNAME: 'test' };
        const spec = daemonServiceSpec({
            platform: 'win32',
            program: 'ruimte.exe',
            args: [],
            home: 'C:\\Users\\test',
            ruimteHome: 'C:\\.ruimte',
            path: '',
            env
        });
        expect(spec.user).toBe('test');
    });

    test('a scheduled task for the person on Windows, with its files under the local app data', () => {
        const env = { LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local', USERDOMAIN: 'DESKTOP-1', USERNAME: 'test' };
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
        const task = scheduledTask(spec);
        expect(task).toContain('<URI>\\app.ruimte.daemon</URI>');
        expect(task).toContain('<UserId>DESKTOP-1\\test</UserId>');
        expect(task).toContain('<WorkingDirectory>C:\\Users\\test\\AppData\\Local\\Ruimte\\service</WorkingDirectory>');
        expect(task).toContain('cd /d C:\\Users\\test ||');
        expect(task).toContain('set ^"RUIMTE_SERVICE=1^"');
        expect(definitionRunsProgram(task, program)).toBe(true);
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
