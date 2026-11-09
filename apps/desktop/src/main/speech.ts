import { join } from 'node:path';
import { electron } from '../electron';
import { heedBodyless } from '../net-response';
import { SpeechService, speechHelperPath } from '../speech';
import { SpeechModel } from '../speech-model';
import type { DesktopIpc } from './ipc';

const { app, net, systemPreferences } = electron;

interface SpeechOptions {
    ruimteHome: string;
    repoRoot: string;
    /* To every window. */
    send(channel: string, payload: unknown): void;
    windows(): Electron.BrowserWindow[];
}

function dictationId(id: unknown): string {
    if (typeof id !== 'string') {
        throw new Error('Invalid dictation request');
    }
    return id;
}

/* Speech to Text and the microphone the windows share. */
export function installSpeech(ipc: DesktopIpc, options: SpeechOptions): void {
    const speechHelper = speechHelperPath(app.isPackaged, join(process.resourcesPath, 'bin', 'ruimte'), options.repoRoot);
    const speechModel = new SpeechModel(
        options.ruimteHome,
        speechHelper,
        (state) => options.send('speech:state', state),
        (input, init) => net.fetch(input instanceof URL ? input.toString() : input, init).then(heedBodyless)
    );
    /* A run's words go back to the page that started it. There is one helper, so one run at a time. */
    const speechService = new SpeechService<Electron.WebContents>(speechHelper, speechModel.directory, speechModel.cacheDirectory, (event, owner) => {
        if (owner && !owner.isDestroyed()) {
            owner.send('speech:event', event);
        }
    });
    app.on('before-quit', () => {
        speechService.dispose();
        speechModel.dispose();
    });
    app.on('web-contents-created', (_event, contents) => {
        const endOwnRun = (): void => {
            if (contents === speechService.owner) {
                speechService.dispose();
            }
        };

        contents.on('render-process-gone', endOwnRun);
        contents.on('did-start-navigation', (_event, _url, _inPlace, isMainFrame) => {
            if (isMainFrame) {
                endOwnRun();
            }
        });
        contents.on('destroyed', endOwnRun);
    });

    ipc.handle('speech:state', async () => {
        await speechModel.initialized;
        return speechModel.state;
    });
    ipc.handle('speech:enable', async (_event, enabled: unknown) => {
        if (typeof enabled !== 'boolean') {
            throw new Error('Invalid speech setting');
        }
        const state = await speechModel.setEnabled(enabled);
        if (!enabled) {
            speechService.dispose();
        }
        return state;
    });
    ipc.handle('speech:remove', async () => {
        await speechModel.setEnabled(false);
        speechService.dispose();
        return speechModel.remove();
    });
    ipc.handle('speech:start', async (event, id: unknown, language: unknown) => {
        await speechModel.initialized;
        if (!speechModel.state.enabled || speechModel.state.phase !== 'ready') {
            throw new Error('Enable speech to text in Settings first');
        }
        if (typeof id !== 'string' || typeof language !== 'string') {
            throw new Error('Invalid dictation request');
        }
        return speechService.start(id, language, event.sender);
    });
    ipc.handle('speech:samples', async (_event, id: unknown, samples: unknown) => speechService.samples(dictationId(id), samples));
    ipc.handle('speech:stop', async (_event, id: unknown) => speechService.stop(dictationId(id)));
    ipc.handle('speech:cancel', (_event, id: unknown) => speechService.cancel(dictationId(id)));

    // The window that takes the microphone ends what listens in every other one, its dictation run included.
    ipc.on('microphone:claim', (event) => {
        if (speechService.owner !== undefined && speechService.owner !== event.sender) {
            speechService.dispose();
        }
        for (const window of options.windows()) {
            if (!window.isDestroyed() && window.webContents !== event.sender) {
                window.webContents.send('microphone:claimed');
            }
        }
    });

    ipc.handle('media:request-microphone', async () => {
        if (process.platform !== 'darwin') {
            return true;
        }
        const status = systemPreferences.getMediaAccessStatus('microphone');
        if (status === 'granted') {
            return true;
        }
        return status === 'not-determined' ? systemPreferences.askForMediaAccess('microphone') : false;
    });
}
