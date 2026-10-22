import { serverActions } from '../actions/server-actions.ts';
import type { CanvasHost } from '../canvas/verb.ts';
import type { ChatManager } from '../chat/chat-manager.ts';
import type { ServerConfig } from '../config.ts';
import type { ProjectStore } from '../projects/project-store.ts';
import { SYSTEM_CLOCK } from '../voice/clock.ts';
import { VoiceKeyStore } from '../voice/key-store.ts';
import { openAiLive, type OpenAiLive } from '../voice/openai-live.ts';
import { VoicePreferencesStore } from '../voice/preferences-store.ts';
import { VoiceSessions } from '../voice/voice-sessions.ts';

export interface VoiceBundle {
    keys: VoiceKeyStore;
    preferences: VoicePreferencesStore;
    sessions: VoiceSessions;
}

export interface VoiceInput {
    config: Pick<ServerConfig, 'home'>;
    projects: Pick<ProjectStore, 'hold' | 'letGo' | 'index' | 'subscribe' | 'list'>;
    /* This machine, the only one whose projects Voice works in. */
    machine: { id: string; label: string };
    canvasHost: CanvasHost;
    chats: Pick<ChatManager, 'observe' | 'get'>;
    /* Only a test hands in another, a fake GPT-Live on loopback. */
    live?: OpenAiLive;
}

/*
 * Voice run by the daemon for a phone, after the canvas host and push: a session runs its tools through the
 * same registry and host the agents' verbs reach.
 */
export function wireVoice(input: VoiceInput): VoiceBundle {
    const { config, projects, canvasHost, chats } = input;
    const keys = new VoiceKeyStore(config.home);
    const preferences = new VoicePreferencesStore(config.home);
    const listening = new Map<string, () => void>();
    const sessions = new VoiceSessions({
        live: input.live ?? openAiLive(),
        key: () => keys.read(),
        preferences: () => preferences.get(),
        clock: SYSTEM_CLOCK,
        // A hold of its own, so the project stays loaded while Voice works in it and no launch starts for it.
        holds: {
            hold: (holder, projectId, changed) => {
                projects.hold(holder, projectId, { startsLaunches: false });
                // Under the holder's own id, so it hears project.changed the way a client holding the project does.
                listening.set(
                    holder,
                    projects.subscribe(holder, (event) => {
                        if (event.event === 'project.changed' && event.payload.projectId === projectId) {
                            changed();
                        }
                    })
                );
            },
            letGo: (holder, projectId) => {
                projects.letGo(holder, projectId);
                listening.get(holder)?.();
                listening.delete(holder);
            }
        },
        runner: serverActions,
        host: canvasHost,
        chats: {
            observe: (sink) => chats.observe(sink),
            thread: (chatId) => {
                const chat = chats.get(chatId);
                return chat === undefined ? null : { items: chat.thread.list(), info: chat.info };
            }
        },
        index: projects.index,
        projects,
        machine: input.machine
    });
    return { keys, preferences, sessions };
}
