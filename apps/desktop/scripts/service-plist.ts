import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { launchAgentPlist } from '@ruimte/service';

/*
 * Prints the LaunchAgent the packaged app writes, pointed at a daemon compiled in this checkout, so
 * launchd can be tried without packaging. The defaults stay clear of an installed Ruimte: another
 * label, port and home. Installing and removing it is by hand: `launchctl bootstrap gui/$(id -u)`
 * with the file, and `launchctl bootout` of the label before deleting it.
 *
 *   bun scripts/service-plist.ts > ~/Library/LaunchAgents/app.ruimte.daemon.try.plist
 */
const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
        label: { type: 'string', default: 'app.ruimte.daemon.try' },
        port: { type: 'string', default: '4212' },
        home: { type: 'string', default: join(homedir(), '.ruimte-service-try') }
    },
    strict: true
});

const repo = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');
const arch = process.arch === 'arm64' ? 'arm64' : 'x64';

process.stdout.write(
    launchAgentPlist({
        label: values.label,
        program: join(repo, 'apps', 'server', 'dist', `mac-${arch}`, 'ruimte'),
        args: ['--port', values.port, '--serve', join(repo, 'apps', 'client', 'dist')],
        environment: { RUIMTE_HOME: values.home, PATH: process.env.PATH ?? '/usr/bin:/bin' },
        workingDirectory: homedir(),
        logFile: join(homedir(), 'Library', 'Logs', 'Ruimte', `${values.label}.log`)
    })
);
