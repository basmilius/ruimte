import { join } from 'node:path';
import { sweepStaleChatWrites } from '../chat/stale-writes.ts';
import { sweepComputerScreenshots } from '../computer/screenshots.ts';
import { sweepPhpCache, type PhpCacheSweepOptions } from '../language/php-cache.ts';
import { Maintenance, type Sweeper } from '../maintenance/maintenance.ts';
import { sweepDeviceCaptures, sweepScreenshots } from '../shots.ts';
import type { LanguageBundle } from './language.ts';
import type { ProcessesBundle } from './processes.ts';
import type { ProjectsBundle } from './projects.ts';

/* Bundles wired after maintenance, reached when a pass runs. */
interface MaintenanceLater {
    language(): LanguageBundle;
    projects(): ProjectsBundle;
}

/* The disposable files of this machine, each on the rule of the code that writes it. */
function sweepersOf(home: string, later: MaintenanceLater): Sweeper[] {
    const php: PhpCacheSweepOptions = {
        cache: () => later.language().host.phpCache(),
        sightingsFile: join(home, 'language-servers', 'php-native', 'cache-sightings.json'),
        knownFolders: () => later.projects().store.index.folders()
    };

    return [
        { name: 'screenshots', sweep: (now, signal) => sweepScreenshots(home, now, signal) },
        { name: 'device captures', sweep: (now, signal) => sweepDeviceCaptures(home, now, signal) },
        { name: 'computer use captures', sweep: (now, signal) => sweepComputerScreenshots(home, now, signal) },
        { name: 'stale chat writes', sweep: (now, signal) => sweepStaleChatWrites(home, now, signal) },
        { name: 'PHP index caches', sweep: (now, signal) => sweepPhpCache(php, now, signal) }
    ];
}

/*
 * Idle means no agent in a turn, since an agent may still read a shot it asked for. A terminal does not
 * count: a dev server never ends, and a pass that waited on one would never run.
 */
export function wireMaintenance(home: string, processes: ProcessesBundle, later: MaintenanceLater): Maintenance {
    return new Maintenance({
        sweepers: sweepersOf(home, later),
        idle: () => processes.machineWork().agents === 0,
        now: Date.now,
        log: (line) => console.log(line)
    });
}
