import { describe, expect, test } from 'bun:test';
import { launchdManager, systemdManager, type CommandResult, type ServiceFiles } from './manager';

const ok = (stdout = ''): CommandResult => ({ code: 0, stdout, stderr: '' });

const fakeRunner = (answers: Record<string, CommandResult | CommandResult[]> = {}) => {
    const calls: string[] = [];
    const run = (command: string, args: string[]): CommandResult => {
        const line = [command, ...args].join(' ');
        calls.push(line);
        const answer = answers[line];
        if (Array.isArray(answer)) {
            return answer.shift() ?? ok();
        }
        return answer ?? ok();
    };
    return { calls, run };
};

const memoryFiles = () => {
    const files = new Map<string, string>();
    const api: ServiceFiles = {
        read: (path) => files.get(path) ?? null,
        write: (path, text) => void files.set(path, text),
        remove: (path) => void files.delete(path)
    };
    return { files, api };
};

const noSleep = async (): Promise<void> => {};

describe('launchdManager', () => {
    const PLIST = '/Users/bas/Library/LaunchAgents/app.ruimte.daemon.plist';
    const PRINT = '/bin/launchctl print gui/501/app.ruimte.daemon';
    const NOT_LOADED: CommandResult = {
        code: 113,
        stdout: '',
        stderr: 'Could not find service'
    };

    test('installs the plist in LaunchAgents and nothing else', () => {
        const runner = fakeRunner();
        const disk = memoryFiles();
        const manager = launchdManager({
            uid: 501,
            home: '/Users/bas',
            run: runner.run,
            files: disk.api,
            sleep: noSleep
        });
        manager.install('<plist/>');
        expect(disk.files.get(PLIST)).toBe('<plist/>');
        expect(manager.isInstalled()).toBe(true);
        expect(runner.calls).toEqual([]);
    });

    test('starts a job that is not loaded with bootstrap, and one that is with kickstart', () => {
        const runner = fakeRunner({ [PRINT]: [NOT_LOADED, ok()] });
        const manager = launchdManager({
            uid: 501,
            home: '/Users/bas',
            run: runner.run,
            files: memoryFiles().api,
            sleep: noSleep
        });
        manager.start();
        manager.start();
        expect(runner.calls).toEqual([PRINT, `/bin/launchctl bootstrap gui/501 ${PLIST}`, PRINT, '/bin/launchctl kickstart gui/501/app.ruimte.daemon']);
    });

    test('restarts with a bootout, waits until launchd let go of the label, then bootstraps', async () => {
        const runner = fakeRunner({ [PRINT]: [ok(), ok(), NOT_LOADED] });
        const manager = launchdManager({
            uid: 501,
            home: '/Users/bas',
            run: runner.run,
            files: memoryFiles().api,
            sleep: noSleep
        });
        await manager.restart();
        expect(runner.calls).toEqual([PRINT, '/bin/launchctl bootout gui/501/app.ruimte.daemon', PRINT, PRINT, `/bin/launchctl bootstrap gui/501 ${PLIST}`]);
    });

    test('a refused bootstrap is an error that says why', () => {
        const runner = fakeRunner({
            [PRINT]: NOT_LOADED,
            [`/bin/launchctl bootstrap gui/501 ${PLIST}`]: {
                code: 5,
                stdout: '',
                stderr: 'Bootstrap failed: 5: Input/output error'
            }
        });
        const manager = launchdManager({
            uid: 501,
            home: '/Users/bas',
            run: runner.run,
            files: memoryFiles().api,
            sleep: noSleep
        });
        expect(() => manager.start()).toThrow('launchctl bootstrap failed (5): Bootstrap failed: 5: Input/output error');
    });

    test('uninstall removes the plist and leaves a running job to stop', () => {
        const runner = fakeRunner();
        const disk = memoryFiles();
        const manager = launchdManager({
            uid: 501,
            home: '/Users/bas',
            run: runner.run,
            files: disk.api,
            sleep: noSleep
        });
        manager.install('<plist/>');
        manager.uninstall();
        expect(disk.files.size).toBe(0);
        expect(runner.calls).toEqual([]);
        manager.stop();
        expect(runner.calls).toEqual([PRINT, '/bin/launchctl bootout gui/501/app.ruimte.daemon']);
    });

    test('a custom label has its own file and launchd target', () => {
        const label = 'app.ruimte.rust.daemon';
        const path = `/Users/bas/Library/LaunchAgents/${label}.plist`;
        const print = `/bin/launchctl print gui/501/${label}`;
        const runner = fakeRunner({ [print]: NOT_LOADED });
        const disk = memoryFiles();
        const manager = launchdManager({
            uid: 501,
            home: '/Users/bas',
            run: runner.run,
            files: disk.api,
            sleep: noSleep,
            label
        });

        manager.install('<plist/>');
        manager.start();

        expect(manager.path).toBe(path);
        expect(disk.files.get(path)).toBe('<plist/>');
        expect(runner.calls).toEqual([print, `/bin/launchctl bootstrap gui/501 ${path}`]);
    });
});

describe('systemdManager', () => {
    const UNIT = '/home/bas/.config/systemd/user/ruimte-daemon.service';

    test('installs the unit, reloads and enables it', () => {
        const runner = fakeRunner();
        const disk = memoryFiles();
        const manager = systemdManager({
            configHome: '/home/bas/.config',
            user: 'bas',
            run: runner.run,
            files: disk.api
        });
        manager.install('[Unit]');
        manager.install('[Unit]');
        expect(disk.files.get(UNIT)).toBe('[Unit]');
        expect(runner.calls).toEqual([
            'systemctl --user daemon-reload',
            'systemctl --user enable ruimte-daemon.service',
            'systemctl --user enable ruimte-daemon.service'
        ]);
    });

    test('uninstall disables the unit and takes the file away', () => {
        const runner = fakeRunner();
        const disk = memoryFiles();
        const manager = systemdManager({
            configHome: '/home/bas/.config',
            user: 'bas',
            run: runner.run,
            files: disk.api
        });
        disk.files.set(UNIT, '[Unit]');
        manager.uninstall();
        expect(disk.files.has(UNIT)).toBe(false);
        expect(runner.calls).toEqual(['systemctl --user disable ruimte-daemon.service', 'systemctl --user daemon-reload']);
    });

    test('lingering is read from loginctl and only enabled when asked', () => {
        const runner = fakeRunner({
            'loginctl show-user bas --property=Linger --value': ok('no\n')
        });
        const manager = systemdManager({
            configHome: '/home/bas/.config',
            user: 'bas',
            run: runner.run,
            files: memoryFiles().api
        });
        expect(manager.linger?.enabled()).toBe(false);
        expect(runner.calls).not.toContain('loginctl enable-linger bas');
        manager.linger?.enable();
        expect(runner.calls).toContain('loginctl enable-linger bas');
    });

    test('a custom unit name has its own file and systemd target', () => {
        const unitName = 'ruimte-rust-daemon.service';
        const path = `/home/bas/.config/systemd/user/${unitName}`;
        const runner = fakeRunner();
        const disk = memoryFiles();
        const manager = systemdManager({
            configHome: '/home/bas/.config',
            user: 'bas',
            run: runner.run,
            files: disk.api,
            unitName
        });

        manager.install('[Unit]');
        manager.start();

        expect(manager.path).toBe(path);
        expect(disk.files.get(path)).toBe('[Unit]');
        expect(runner.calls).toEqual(['systemctl --user daemon-reload', `systemctl --user enable ${unitName}`, `systemctl --user start ${unitName}`]);
    });
});
