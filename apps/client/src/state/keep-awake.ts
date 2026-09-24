import { desktop, type DesktopBridge, type KeepAwakeRequest } from '@/desktop/bridge';
import { agentsWorking } from '@/state/agent-work';
import { useChats, type ChatsById } from '@/state/chats';
import { useSessions, type SessionsByKey } from '@/state/sessions';
import { useSettings, type Settings } from '@/state/settings';

export type KeepAwakeSettings = Pick<Settings, 'keepAwake' | 'keepAwakeOnBattery' | 'keepAwakeDisplay'>;

/*
 * The whole decision: the setting first, so nothing is counted for someone who never asked. Whether
 * the Mac is on battery is not in here; the shell sees that change and weighs it itself.
 */
export const keepAwakeWanted = (settings: KeepAwakeSettings, sessions: SessionsByKey, chats: ChatsById): KeepAwakeRequest | null => {
    if (settings.keepAwake === 'off') {
        return null;
    }
    if (settings.keepAwake === 'working' && !agentsWorking(sessions, chats)) {
        return null;
    }
    return { onBattery: settings.keepAwakeOnBattery, display: settings.keepAwake === 'always' && settings.keepAwakeDisplay };
};

const sameRequest = (one: KeepAwakeRequest | null, other: KeepAwakeRequest | null): boolean =>
    one === other || (one !== null && other !== null && one.onBattery === other.onBattery && one.display === other.display);

/*
 * How to tell the shell, or undefined where there is none to tell or it is not a Mac. A shell from
 * before the request only knows a switch, which holds the system on any power source and never the
 * display; that is the closest it comes, until it restarts onto the new preload.
 */
export const keepAwakeTeller = (bridge: DesktopBridge | null): ((request: KeepAwakeRequest | null) => void) | undefined => {
    if (bridge?.platform !== 'darwin') {
        return undefined;
    }
    if (bridge.requestKeepAwake) {
        return bridge.requestKeepAwake;
    }
    const setKeepAwake = bridge.setKeepAwake;
    return setKeepAwake ? (request) => setKeepAwake(request !== null) : undefined;
};

/*
 * Holds the shell's power block for as long as the setting asks for one. Driven by the two stores the
 * hooks write into, so it moves with the first agent that starts and the last one that settles and
 * never polls. Takes the call to make, which a test hands a spy, so the only untested step is the IPC
 * send itself. Returns the unsubscribe, or null where there is no shell to ask.
 */
export const startKeepAwake = (tell: ((request: KeepAwakeRequest | null) => void) | undefined = keepAwakeTeller(desktop())): (() => void) | null => {
    if (!tell) {
        return null;
    }
    // What the shell was last told. Turning the setting off mid-turn has to reach it as well.
    let held: KeepAwakeRequest | null = null;

    const check = (): void => {
        const wanted = keepAwakeWanted(useSettings.getState(), useSessions.getState().byKey, useChats.getState().byKey);
        if (sameRequest(wanted, held)) {
            return;
        }
        held = wanted;
        tell(wanted);
    };

    const offSessions = useSessions.subscribe(check);
    const offChats = useChats.subscribe(check);
    const offSettings = useSettings.subscribe(check);
    // `always` holds from the start, before any store has moved.
    check();
    return () => {
        offSessions();
        offChats();
        offSettings();
        if (held !== null) {
            held = null;
            tell(null);
        }
    };
};
