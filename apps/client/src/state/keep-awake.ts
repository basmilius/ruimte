import { desktop } from '@/desktop/bridge';
import { useChats, type ChatsById } from '@/state/chats';
import { useSessions, type SessionsByKey } from '@/state/sessions';
import { useSettings } from '@/state/settings';

/*
 * Whether an agent is in the middle of a turn, over every machine this window is watching. Not
 * `nodeStatus`: that calls a terminal running the moment it is attached, which every terminal is,
 * and a shell waiting at its prompt is no reason to keep a laptop from sleeping. So a session
 * counts only through the agent its hooks reported, and only while that agent is `live`, since a
 * record left behind by a CLI that went down with its shell keeps whatever status it had. Chats
 * carry the same status on their thread. `needs-you` is a person's turn, not work.
 */
export const agentsWorking = (sessions: SessionsByKey, chats: ChatsById): boolean => {
    for (const session of Object.values(sessions)) {
        if (session.agent?.live && session.agent.status === 'running') {
            return true;
        }
    }
    for (const chat of Object.values(chats)) {
        if (chat.info.status === 'running') {
            return true;
        }
    }
    return false;
};

/* The whole decision: the setting first, so nothing is counted for someone who never asked. */
export const keepAwakeWanted = (enabled: boolean, sessions: SessionsByKey, chats: ChatsById): boolean => enabled && agentsWorking(sessions, chats);

/*
 * Holds the shell's power block for as long as an agent works. Driven by the two stores the hooks
 * write into, so it moves with the first agent that starts and the last one that settles and never
 * polls. Returns the unsubscribe, or null in a browser, which has no shell to ask.
 */
export const startKeepAwake = (): (() => void) | null => {
    const bridge = desktop();
    if (!bridge?.setKeepAwake) {
        return null;
    }
    const tell = bridge.setKeepAwake;
    // What the shell was last told. Turning the setting off mid-turn has to reach it as well.
    let held = false;

    const check = (): void => {
        const wanted = keepAwakeWanted(useSettings.getState().agentsKeepAwake, useSessions.getState().byKey, useChats.getState().byKey);
        if (wanted === held) {
            return;
        }
        held = wanted;
        tell(wanted);
    };

    const offSessions = useSessions.subscribe(check);
    const offChats = useChats.subscribe(check);
    const offSettings = useSettings.subscribe(check);
    return () => {
        offSessions();
        offChats();
        offSettings();
        if (held) {
            held = false;
            tell(false);
        }
    };
};
