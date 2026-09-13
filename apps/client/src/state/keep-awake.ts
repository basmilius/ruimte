import { desktop } from '@/desktop/bridge';
import { agentsWorking } from '@/state/agent-work';
import { useChats, type ChatsById } from '@/state/chats';
import { useSessions, type SessionsByKey } from '@/state/sessions';
import { useSettings } from '@/state/settings';

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
