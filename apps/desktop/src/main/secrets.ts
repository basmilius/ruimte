import { join } from 'node:path';
import { liveTools, mintLiveSession, parseOpenAiLivePreferences } from '@ruimte/voice';
import { databaseSecretFile, parseSecret, parseSecretKey } from '../database-bridge';
import { electron } from '../electron';
import { heedBodyless } from '../net-response';
import { fileSecretStore, type SecretStore } from '../secret-store';
import type { DesktopIpc } from './ipc';
import { pendingRemovalFile, voiceKey, type MachineVoiceKey } from './voice-key';

const { app, net, safeStorage } = electron;

interface InstalledSecrets {
    /* Gives the saved OpenAI key to the app's own daemon, for the Voice it runs for a phone. */
    handOverVoiceKey(): Promise<void>;
}

/* The OpenAI API key and the database passwords, which stay in the shell, encrypted with the OS keychain. */
export function installSecrets(ipc: DesktopIpc, machineVoiceKey: MachineVoiceKey | null): InstalledSecrets {
    let openAiKeyStore: SecretStore | null = null;

    const openAiKeys = (): SecretStore => {
        openAiKeyStore ??= fileSecretStore(join(app.getPath('userData'), 'openai-api-key.bin'), safeStorage);
        return openAiKeyStore;
    };

    const voice = voiceKey(openAiKeys, pendingRemovalFile(join(app.getPath('userData'), 'openai-api-key-removal')), machineVoiceKey);

    // One file per key. Kept so a store without encryption still holds its secrets in memory until the app quits.
    const databaseSecretStores = new Map<string, SecretStore>();

    const databaseSecrets = (key: string): SecretStore => {
        const path = databaseSecretFile(join(app.getPath('userData'), 'database-secrets'), key);
        let store = databaseSecretStores.get(path);
        if (store === undefined) {
            // A password the keychain no longer opens is said, or a person only sees the server turn the login down.
            store = fileSecretStore(path, safeStorage, { reportUnreadable: true });
            databaseSecretStores.set(path, store);
        }
        return store;
    };

    ipc.handle('openai:credential-status', () => voice.status());

    ipc.handle('database:secret-read', (_event, key: unknown) => databaseSecrets(parseSecretKey(key)).read());

    ipc.handle('database:secret-write', (_event, key: unknown, secret: unknown) => databaseSecrets(parseSecretKey(key)).write(parseSecret(secret)));

    ipc.handle('database:secret-persistent', () => safeStorage.isEncryptionAvailable());

    ipc.handle('openai:save-api-key', async (_event, apiKey: unknown) => {
        if (typeof apiKey !== 'string' || apiKey.trim() === '') {
            throw new Error('Enter an API key');
        }
        return voice.save(apiKey.trim());
    });

    ipc.handle('openai:clear-api-key', () => voice.remove());

    ipc.handle('openai:create-live-session', async (_event, sdp: unknown, preferences: unknown) => {
        if (typeof sdp !== 'string') {
            throw new Error('The microphone session offer is invalid');
        }
        const requested = parseOpenAiLivePreferences(preferences);
        if (!requested) {
            throw new Error('The GPT-Live voice settings are invalid');
        }
        const apiKey = await openAiKeys().read();
        if (apiKey === null) {
            throw new Error('Add an OpenAI API key in Settings first');
        }
        return mintLiveSession(
            (input, init) => net.fetch(input, init).then(heedBodyless),
            apiKey,
            { language: requested.language, voice: requested.voice, tools: liveTools(requested), sdp },
            'desktop'
        );
    });

    return { handOverVoiceKey: () => voice.handOver() };
}
