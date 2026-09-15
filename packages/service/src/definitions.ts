/*
 * The text of the background service: a launchd property list on macOS and a systemd user unit on
 * Linux. Pure, so the files are snapshots in a test rather than something found out on a machine.
 */

/* The label launchd knows the job by, and the file name of the plist under ~/Library/LaunchAgents. */
export const LAUNCH_AGENT_LABEL = 'app.ruimte.daemon';

/* The unit's name under ~/.config/systemd/user. */
export const SYSTEMD_UNIT_NAME = 'ruimte-daemon.service';

export interface ServiceSpec {
    /* The launchd label; the unit name has no use for one. */
    label: string;
    /* The daemon binary and its arguments, absolute. */
    program: string;
    args: string[];
    /* What the daemon gets: `RUIMTE_HOME` and the login shell's `PATH`, so a terminal finds the person's tools. */
    environment: Record<string, string>;
    workingDirectory: string;
    /* launchd only: where stdout and stderr go. systemd has the journal. */
    logFile: string;
}

const xmlText = (value: string): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const plistString = (value: string, indent: string): string => `${indent}<string>${xmlText(value)}</string>`;

/*
 * `KeepAlive` brings the daemon back after a crash, and it is also what hands the port over when the
 * app quits: a service started while the app's own daemon still holds the port exits, and launchd
 * starts it again once the port is free. `ProcessType` is Interactive because launchd throttles the
 * CPU and I/O of a job that leaves it out, and an agent's turn is anything but background work.
 */
export const launchAgentPlist = (spec: ServiceSpec): string => {
    const lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
        '<plist version="1.0">',
        '<dict>',
        '    <key>Label</key>',
        plistString(spec.label, '    '),
        '    <key>ProgramArguments</key>',
        '    <array>',
        ...[spec.program, ...spec.args].map((arg) => plistString(arg, '        ')),
        '    </array>',
        '    <key>EnvironmentVariables</key>',
        '    <dict>'
    ];
    for (const [name, value] of Object.entries(spec.environment)) {
        lines.push(`        <key>${xmlText(name)}</key>`, plistString(value, '        '));
    }
    lines.push(
        '    </dict>',
        '    <key>WorkingDirectory</key>',
        plistString(spec.workingDirectory, '    '),
        '    <key>RunAtLoad</key>',
        '    <true/>',
        '    <key>KeepAlive</key>',
        '    <true/>',
        '    <key>ProcessType</key>',
        '    <string>Interactive</string>',
        '    <key>StandardOutPath</key>',
        plistString(spec.logFile, '    '),
        '    <key>StandardErrorPath</key>',
        plistString(spec.logFile, '    '),
        '</dict>',
        '</plist>',
        ''
    );
    return lines.join('\n');
};

/* systemd expands `%` specifiers everywhere and `$` variables in a command line, so both are doubled; quotes keep a space in a path. */
const unitWord = (value: string, command: boolean): string => {
    let escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/%/g, '%%');
    if (command) {
        escaped = escaped.replace(/\$/g, '$$$$');
    }
    return `"${escaped}"`;
};

/*
 * `Restart=always` is launchd's KeepAlive, including the handover of the port when the app quits.
 * `default.target` starts it with the person's session; after logout it only runs with lingering,
 * which is a step the app offers and never takes by itself.
 */
export const systemdUnit = (spec: ServiceSpec): string => {
    const lines = [
        '[Unit]',
        'Description=Ruimte machine',
        '',
        '[Service]',
        'Type=simple',
        `ExecStart=${[spec.program, ...spec.args].map((word) => unitWord(word, true)).join(' ')}`,
        ...Object.entries(spec.environment).map(([name, value]) => `Environment=${unitWord(`${name}=${value}`, false)}`),
        // The one setting here that takes no quotes: it reads the rest of the line as the path.
        `WorkingDirectory=${spec.workingDirectory.replace(/%/g, '%%')}`,
        'Restart=always',
        'RestartSec=2',
        '',
        '[Install]',
        'WantedBy=default.target',
        ''
    ];
    return lines.join('\n');
};

/*
 * Whether a definition on disk starts this program. The desktop app and `ruimte service` write the
 * same label and unit name, so each checks this before it rewrites or removes the other's service.
 */
export const definitionRunsProgram = (definition: string, program: string): boolean =>
    definition.includes(`<string>${xmlText(program)}</string>`) ||
    definition.includes(`ExecStart=${unitWord(program, true)} `) ||
    definition.includes(`ExecStart=${unitWord(program, true)}\n`);
