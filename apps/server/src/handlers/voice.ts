import { RequestError, type Dispatcher } from '../dispatcher.ts';
import type { VoiceKeyStore } from '../voice/key-store.ts';
import type { VoiceSessions } from '../voice/voice-sessions.ts';

export interface VoiceHandlerDeps {
    keys: Pick<VoiceKeyStore, 'has' | 'write' | 'clear'>;
    sessions: Pick<VoiceSessions, 'start' | 'stop' | 'confirm'>;
}

/*
 * Voice run by the daemon. Registered only with RUIMTE_EXPERIMENTAL_VOICE=1, so `endpoint.info` names
 * these requests only then, and none is on a peer's list: another machine is refused before its payload
 * is read. Only the local secret sets or clears the key; whether one is set is every person's to know,
 * since the phone shows Voice only then. Owning a session is a matter of the connection and scene that
 * started it, which `VoiceSessions` checks; it is apart from owning the machine.
 */
export function registerVoiceHandlers(dispatcher: Dispatcher, deps: VoiceHandlerDeps): void {
    const { keys, sessions } = deps;
    dispatcher.register('voice.keyStatus', async () => ({ present: await keys.has() }));
    dispatcher.register(
        'voice.setKey',
        async ({ key }) => {
            try {
                await keys.write(key);
            } catch (e) {
                // The store says what is wrong with the key without quoting it; a failed write says nothing more.
                throw new RequestError('invalid-key', e instanceof Error ? e.message : 'The key could not be saved');
            }
            return { present: true };
        },
        { owner: true }
    );
    dispatcher.register(
        'voice.clearKey',
        async () => {
            await keys.clear();
            return { present: false };
        },
        { owner: true }
    );
    dispatcher.register('voice.start', (payload, client) => sessions.start(client, payload));
    dispatcher.register('voice.stop', (payload, client) => sessions.stop(client, payload));
    dispatcher.register('voice.confirm', (payload, client) => sessions.confirm(client, payload));
}
