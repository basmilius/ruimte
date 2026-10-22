import { homedir } from 'node:os';
import { join } from 'node:path';
import { serverActions } from '../actions/server-actions.ts';
import type { CanvasHost } from '../canvas/verb.ts';
import type { ChatManager } from '../chat/chat-manager.ts';
import type { ServerConfig } from '../config.ts';
import type { ProjectStore } from '../projects/project-store.ts';
import { SYSTEM_CLOCK } from '../voice/clock.ts';
import { VoiceKeyStore, voiceKeyHomeProblem } from '../voice/key-store.ts';
import { openAiLive, type OpenAiLive } from '../voice/openai-live.ts';
import { VoiceSessions } from '../voice/voice-sessions.ts';

export interface VoiceBundle {
    keys: VoiceKeyStore;
    sessions: VoiceSessions;
    /* Why the requests of the local secret set no key in this home, as `ruimte voice key` refuses it too. */
    keyHomeProblem: string | null;
}

export interface VoiceInput {
    config: Pick<ServerConfig, 'home' | 'experimentalVoice'>;
    projects: Pick<ProjectStore, 'hold' | 'letGo' | 'index' | 'subscribe' | 'list'>;
    /* This machine, the only one whose projects Voice works in. */
    machine: { id: string; label: string };
    canvasHost: CanvasHost;
    chats: Pick<ChatManager, 'observe' | 'get'>;
    compiled: boolean;
    /* `~/.ruimte`, where an installed Ruimte keeps its state; a test names another. */
    installedHome?: string;
    /* Only a test hands in another, a fake GPT-Live on loopback. */
    live?: OpenAiLive;
}

/*
 * Voice run by the daemon for a phone, after the canvas host and push: a session runs its tools through the
 * same registry and host the agents' verbs reach. Null without RUIMTE_EXPERIMENTAL_VOICE=1, so nothing of
 * it is wired, answered or named to a client.
 */
export function wireVoice(input: VoiceInput): VoiceBundle | null {
    const { config, projects, canvasHost, chats } = input;
    if (!config.experimentalVoice.enabled) {
        return null;
    }
    const keys = new VoiceKeyStore(config.home);
    const listening = new Map<string, () => void>();
    const sessions = new VoiceSessions({
        live: input.live ?? openAiLive(),
        key: () => keys.read(),
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
        machine: input.machine,
        writes: config.experimentalVoice.writes
    });
    console.log(
        config.experimentalVoice.writes
            ? 'Experimental Voice for phones is on, and may prompt and start chats'
            : 'Experimental Voice for phones is on, reading only'
    );
    const keyHomeProblem = voiceKeyHomeProblem({
        home: config.home,
        installedHome: input.installedHome ?? join(homedir(), '.ruimte'),
        compiled: input.compiled
    });
    return { keys, sessions, keyHomeProblem };
}
