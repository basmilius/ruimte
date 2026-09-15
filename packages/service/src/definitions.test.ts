import { describe, expect, test } from 'bun:test';
import { LAUNCH_AGENT_LABEL, definitionRunsProgram, launchAgentPlist, systemdUnit, type ServiceSpec } from './definitions';

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

describe('the service of the npm package', () => {
    const NPM_MAC: ServiceSpec = {
        ...MAC,
        program: '/Users/bas/.ruimte/bin/ruimte',
        args: []
    };
    const NPM_LINUX: ServiceSpec = {
        ...LINUX,
        program: '/home/bas/.ruimte/bin/ruimte',
        args: ['--host', '0.0.0.0']
    };

    test('points the LaunchAgent at the copy under the home', () => {
        const plist = launchAgentPlist(NPM_MAC);
        expect(plist).toContain('<string>/Users/bas/.ruimte/bin/ruimte</string>');
        expect(plist).not.toContain('_npx');
    });

    test('points the user unit at the copy under the home', () => {
        expect(systemdUnit(NPM_LINUX)).toContain('ExecStart="/home/bas/.ruimte/bin/ruimte" "--host" "0.0.0.0"');
    });

    test('tells a definition that runs a program from one that runs another', () => {
        expect(definitionRunsProgram(launchAgentPlist(NPM_MAC), NPM_MAC.program)).toBe(true);
        expect(definitionRunsProgram(launchAgentPlist(MAC), NPM_MAC.program)).toBe(false);
        expect(definitionRunsProgram(systemdUnit(NPM_LINUX), NPM_LINUX.program)).toBe(true);
        expect(definitionRunsProgram(systemdUnit({ ...NPM_LINUX, args: [] }), NPM_LINUX.program)).toBe(true);
        expect(definitionRunsProgram(systemdUnit(LINUX), NPM_LINUX.program)).toBe(false);
        // A path that only starts the same way is another program.
        expect(definitionRunsProgram(launchAgentPlist({ ...NPM_MAC, program: '/Users/bas/.ruimte/bin/ruimte-old' }), NPM_MAC.program)).toBe(false);
    });
});
