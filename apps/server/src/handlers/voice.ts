import { CodedError } from '@adecore/agents';
import type { Area } from '../area.ts';
import { type Dispatcher } from '../dispatcher.ts';
import type { VoiceKeyStore } from '../voice/key-store.ts';
import type { VoicePreferencesStore } from '../voice/preferences-store.ts';
import type { VoiceSessions } from '../voice/voice-sessions.ts';

export interface VoiceDeps {
    keys: Pick<VoiceKeyStore, 'has' | 'write' | 'clear'>;
    preferences: Pick<VoicePreferencesStore, 'get' | 'set' | 'subscribe'>;
    sessions: Pick<VoiceSessions, 'start' | 'stop' | 'confirm' | 'channelClosed' | 'stopAll'>;
}

/*
 * Voice run by the daemon. No `voice.*` request is on a peer's list: another machine is refused before
 * its payload is read. Only the local secret sets or clears the key; whether one is set is every person's
 * to know, since the phone shows Voice only then. How Voice talks is every client's to read and set, as
 * any of them may start it. Owning a session is a matter of the connection and scene that started it,
 * which `VoiceSessions` checks; it is apart from owning the machine.
 */
export function voiceArea(deps: VoiceDeps): Area {
    const { preferences, sessions } = deps;

    return {
        name: 'voice',
        sources: [preferences],
        handlers: (dispatcher) => registerRequests(dispatcher, deps),
        closed: (clientId, access) => {
            if (access.peer === undefined) {
                sessions.channelClosed(clientId);
            }
        },
        // Before the sessions go: a Voice session left open at OpenAI keeps costing.
        stop: [{ phase: 'drain', label: 'Ending Voice sessions', run: () => sessions.stopAll() }]
    };
}

function registerRequests(dispatcher: Dispatcher, { keys, preferences, sessions }: VoiceDeps): void {
    dispatcher.register('voice.keyStatus', async () => ({ present: await keys.has() }));
    dispatcher.register(
        'voice.setKey',
        async ({ key }) => {
            try {
                await keys.write(key);
            } catch (e) {
                // The store says what is wrong with the key without quoting it; a failed write says nothing more.
                throw new CodedError('invalid-key', e instanceof Error ? e.message : 'The key could not be saved');
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
    dispatcher.register('voice.preferences', () => ({ preferences: preferences.get() }));
    dispatcher.register('voice.setPreferences', (payload) => ({ preferences: preferences.set(payload) }));
    dispatcher.register('voice.start', (payload, client) => sessions.start(client, payload), { count: ['voice.sessions'] });
    dispatcher.register('voice.stop', (payload, client) => sessions.stop(client, payload));
    dispatcher.register('voice.confirm', (payload, client) => sessions.confirm(client, payload));
}
