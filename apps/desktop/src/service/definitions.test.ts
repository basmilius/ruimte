import { describe, expect, test } from 'bun:test';
import { LAUNCH_AGENT_LABEL, launchAgentPlist, systemdUnit, type ServiceSpec } from './definitions';

const MAC: ServiceSpec = {
    label: LAUNCH_AGENT_LABEL,
    program: '/Applications/Ruimte.app/Contents/Resources/bin/ruimte',
    args: ['--port', '4210', '--serve', '/Applications/Ruimte.app/Contents/Resources/client'],
    environment: { RUIMTE_HOME: '/Users/bas/.ruimte', PATH: '/opt/homebrew/bin:/usr/bin:/bin' },
    workingDirectory: '/Users/bas',
    logFile: '/Users/bas/Library/Logs/Ruimte/daemon.log'
};

const LINUX: ServiceSpec = {
    label: LAUNCH_AGENT_LABEL,
    program: '/opt/Ruimte/resources/bin/ruimte',
    args: ['--port', '4210', '--serve', '/opt/Ruimte/resources/client'],
    environment: { RUIMTE_HOME: '/home/bas/.ruimte', PATH: '/home/bas/.local/bin:/usr/bin:/bin' },
    workingDirectory: '/home/bas',
    logFile: '/home/bas/.config/Ruimte/logs/daemon.log'
};

describe('launchAgentPlist', () => {
    test('the LaunchAgent of a packaged app', () => {
        expect(launchAgentPlist(MAC)).toMatchSnapshot();
    });

    test('escapes what XML would read as markup', () => {
        const plist = launchAgentPlist({ ...MAC, workingDirectory: '/Users/a&b/<x>' });
        expect(plist).toContain('<string>/Users/a&amp;b/&lt;x&gt;</string>');
    });
});

describe('systemdUnit', () => {
    test('the user unit of a packaged app', () => {
        expect(systemdUnit(LINUX)).toMatchSnapshot();
    });

    test('quotes a space and doubles what systemd would expand', () => {
        const unit = systemdUnit({ ...LINUX, program: '/opt/My Apps/ruimte', environment: { PATH: '/a%b:$HOME/bin' } });
        expect(unit).toContain('ExecStart="/opt/My Apps/ruimte" "--port"');
        expect(unit).toContain('Environment="PATH=/a%%b:$HOME/bin"');
    });

    test('doubles a dollar in the command line, where systemd expands variables', () => {
        const unit = systemdUnit({ ...LINUX, args: ['--label', 'a$b'] });
        expect(unit).toContain('"a$$b"');
    });
});
