import { serverActions } from '../actions/server-actions.ts';
import type { CanvasHost } from '../canvas/verb.ts';
import type { ServerConfig } from '../config.ts';
import type { ProjectStore } from '../projects/project-store.ts';
import { SYSTEM_CLOCK } from '../voice/clock.ts';
import { VoiceKeyStore } from '../voice/key-store.ts';
import { openAiLive, type OpenAiLive } from '../voice/openai-live.ts';
import { VoiceSessions } from '../voice/voice-sessions.ts';

export interface VoiceBundle {
    keys: VoiceKeyStore;
    sessions: VoiceSessions;
}

export interface VoiceInput {
    config: Pick<ServerConfig, 'home' | 'experimentalVoice'>;
    projects: Pick<ProjectStore, 'hold' | 'letGo' | 'index'>;
    canvasHost: CanvasHost;
    /* Only a test hands in another, a fake GPT-Live on loopback. */
    live?: OpenAiLive;
}

/*
 * Voice run by the daemon for a phone, after the canvas host and push: a session runs its tools through the
 * same registry and host the agents' verbs reach. Null without RUIMTE_EXPERIMENTAL_VOICE=1, so nothing of
 * it is wired, answered or named to a client.
 */
export function wireVoice(input: VoiceInput): VoiceBundle | null {
    const { config, projects, canvasHost } = input;
    if (!config.experimentalVoice.enabled) {
        return null;
    }
    const keys = new VoiceKeyStore(config.home);
    const sessions = new VoiceSessions({
        live: input.live ?? openAiLive(),
        key: () => keys.read(),
        clock: SYSTEM_CLOCK,
        // A hold of its own, so the project stays loaded while Voice works in it and no launch starts for it.
        holds: {
            hold: (holder, projectId) => projects.hold(holder, projectId, { startsLaunches: false }),
            letGo: (holder, projectId) => projects.letGo(holder, projectId)
        },
        runner: serverActions,
        host: canvasHost,
        index: projects.index,
        writes: config.experimentalVoice.writes
    });
    console.log(
        config.experimentalVoice.writes
            ? 'Experimental Voice for phones is on, and may prompt and start chats'
            : 'Experimental Voice for phones is on, reading only'
    );
    return { keys, sessions };
}
