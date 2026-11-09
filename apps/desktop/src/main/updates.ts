import { join } from 'node:path';
import { createUpdater, type Windows } from '@adecore/shell';
import { electron } from '../electron';
import { heedBodyless } from '../net-response';
import { createReleaseNotes } from '../release-notes';
import type { DesktopIpc } from './ipc';
import type { Machine } from './service';

const { app, net } = electron;

export interface UpdatesOptions {
    windows: Windows;
    machine: Pick<Machine, 'controller' | 'stopsOnQuit'>;
    /* Asks the person whether the quit may end what it ends; true when nothing needs asking. */
    askBeforeQuit(stopsMachine: boolean): Promise<boolean>;
    /* Marks the quit that follows as asked already, or takes that back. */
    confirmQuit(confirmed: boolean): void;
}

export interface Updates {
    start(): void;
}

/* The updater and the release notes beside it, a state the page watches rather than a dialog that interrupts. */
export function installUpdates(ipc: DesktopIpc, options: UpdatesOptions): Updates {
    const { windows, machine } = options;

    /* From the REST API: the updater's atom feed carries rendered HTML, only the versions up to the next one,
       and tags whose release is still a draft. */
    const releaseNotes = createReleaseNotes({
        fetch: (url, init) => net.fetch(url, init).then(heedBodyless),
        // A new name, or GitHub's 304 would keep the list from before it held prereleases.
        cacheFile: join(app.getPath('userData'), 'release-notes-with-prereleases.json')
    });

    const updater = createUpdater({
        currentVersion: app.getVersion(),
        packaged: app.isPackaged,
        load: () => (require('electron-updater') as typeof import('electron-updater')).autoUpdater,
        publish: (state) => windows.send('update:state', state),
        onQuit: windows.quitForUpdate,
        silentInstall: process.platform === 'win32',
        // Refreshed with the check, so the notes of a version it finds are on disk before anyone asks.
        beforeCheck: () => void releaseNotes.list(true)
    });

    /*
     * Installing closes every window before it quits, so a quit that ends work is asked about while they
     * are still there. Not when `confirmed`: a person asked from another client after being told what ends.
     */
    const install = async (confirmed: boolean): Promise<void> => {
        // Windows will not replace an executable that runs, so there the installer ends the service's daemon too.
        const installerStopsMachine = process.platform === 'win32';
        if (
            !confirmed &&
            !machine.controller.survivesQuit(installerStopsMachine) &&
            !(await options.askBeforeQuit(installerStopsMachine || machine.stopsOnQuit()))
        ) {
            return;
        }
        options.confirmQuit(true);
        if (!updater.install()) {
            options.confirmQuit(false);
        }
    };

    ipc.handle('update:state', () => updater.state());

    ipc.handle('update:configure', (_event, autoDownload: unknown) => updater.configure(autoDownload));

    // Not through `channel`, which would also allow a downgrade: a beta on Stable keeps running until a newer release.
    ipc.handle('update:track', (_event, track: unknown) => updater.setAllowPrerelease(track === 'prerelease'));

    ipc.handle('update:check', () => updater.check());

    ipc.handle('update:download', () => updater.download());

    ipc.on('update:install', (_event, confirmed: unknown) => void install(confirmed === true));

    ipc.handle('releases:list', (_event, refresh?: boolean) => releaseNotes.list(refresh === true));

    return {
        start: () => updater.start()
    };
}
