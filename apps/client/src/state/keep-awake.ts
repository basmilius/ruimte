import i18next from 'i18next';
import { canKeepAwake, desktop, type DesktopBridge, type KeepAwakeRequest } from '@/desktop/bridge';
import { agentsWorking } from '@/state/agent-work';
import { useChats, type ChatsById } from '@ruimte/agents-react/state/chats';
import { LOCAL_ENDPOINT_ID } from '@/state/endpoints';
import { hasLocalMachine } from '@/state/local-machine';
import { serverInfoOf, useServers, type ServerInfo } from '@/state/server';
import { useSessions, type SessionsByKey } from '@/state/sessions';
import { useSettings, type Settings } from '@/state/settings';
import { useToasts } from '@/state/toasts';
import { transportFor } from '@/transport';

export type KeepAwakeSettings = Pick<Settings, 'keepAwake' | 'keepAwakeOnBattery' | 'keepAwakeDisplay'>;

/*
 * Keep awake belongs to this computer's own machine: its daemon holds the block, with no window open
 * and for a phone that set it. Against a daemon from before, which says nothing of it, this client
 * keeps the setting itself and has the shell hold the block while a window is open, as it always did.
 */
export const machineKeepsAwake = (info: Pick<ServerInfo, 'keepAwake' | 'keepAwakeAvailable'>): boolean => info.keepAwake !== null && info.keepAwakeAvailable;

const localInfo = (): ServerInfo => serverInfoOf(LOCAL_ENDPOINT_ID);

/* The setting as it stands, wherever it is kept. */
export const keepAwakeChoice = (info: ServerInfo = localInfo(), settings: KeepAwakeSettings = useSettings.getState()): KeepAwakeSettings =>
    machineKeepsAwake(info) && info.keepAwake !== null
        ? { keepAwake: info.keepAwake, keepAwakeOnBattery: info.keepAwakeOnBattery, keepAwakeDisplay: info.keepAwakeDisplay }
        : { keepAwake: settings.keepAwake, keepAwakeOnBattery: settings.keepAwakeOnBattery, keepAwakeDisplay: settings.keepAwakeDisplay };

/* Whether this computer's machine holds keep awake, inside a render. */
export const useMachineKeepsAwake = (): boolean =>
    useServers((s) => hasLocalMachine() && machineKeepsAwake(s.byEndpoint[LOCAL_ENDPOINT_ID] ?? { keepAwake: null, keepAwakeAvailable: false }));

/* The setting as it stands, inside a render. Each field is selected on its own, so the choice is not a new object per call. */
export const useKeepAwakeChoice = (): KeepAwakeSettings => {
    const onMachine = useMachineKeepsAwake();
    const machineMode = useServers((s) => s.byEndpoint[LOCAL_ENDPOINT_ID]?.keepAwake ?? null);
    const machineBattery = useServers((s) => s.byEndpoint[LOCAL_ENDPOINT_ID]?.keepAwakeOnBattery === true);
    const machineDisplay = useServers((s) => s.byEndpoint[LOCAL_ENDPOINT_ID]?.keepAwakeDisplay === true);
    const keepAwake = useSettings((s) => s.keepAwake);
    const keepAwakeOnBattery = useSettings((s) => s.keepAwakeOnBattery);
    const keepAwakeDisplay = useSettings((s) => s.keepAwakeDisplay);
    return onMachine && machineMode !== null
        ? { keepAwake: machineMode, keepAwakeOnBattery: machineBattery, keepAwakeDisplay: machineDisplay }
        : { keepAwake, keepAwakeOnBattery, keepAwakeDisplay };
};

/* Whether there is anything to keep awake: this computer's machine, or else a Mac shell from before. */
export const keepAwakeAvailable = (): boolean => (hasLocalMachine() && machineKeepsAwake(localInfo())) || canKeepAwake();

/* The same as `keepAwakeAvailable` inside a render, which follows the machine as it answers. */
export const useKeepAwakeAvailable = (): boolean => useMachineKeepsAwake() || canKeepAwake();

/* The machine takes name, icon and switches together, so the name and icon it has go back with it. */
const saveOnMachine = async (patch: Partial<KeepAwakeSettings>): Promise<void> => {
    const link = transportFor(LOCAL_ENDPOINT_ID);
    if (!link) {
        return;
    }
    const info = localInfo();
    const answer = await link.request('endpoint.setIdentity', {
        // A machine nobody named answers to its own default, and sending that name back would make it chosen.
        name: info.nameSource === 'chosen' ? info.label : null,
        icon: info.icon,
        keepAwake: patch.keepAwake,
        keepAwakeOnBattery: patch.keepAwakeOnBattery,
        keepAwakeDisplay: patch.keepAwakeDisplay
    });
    useServers.getState().setIdentity(LOCAL_ENDPOINT_ID, {
        label: answer.label,
        nameSource: answer.nameSource ?? null,
        icon: answer.icon ?? null,
        agentsDeleteAnyView: answer.agentsDeleteAnyView === true,
        keepAwake: answer.keepAwake ?? null,
        keepAwakeOnBattery: answer.keepAwakeOnBattery === true,
        keepAwakeDisplay: answer.keepAwakeDisplay === true
    });
};

/* Sets keep awake where it is kept: on this computer's machine, or in this client for a daemon from before. */
export const setKeepAwake = (patch: Partial<KeepAwakeSettings>): void => {
    if (!machineKeepsAwake(localInfo())) {
        useSettings.getState().update(patch);
        return;
    }
    void saveOnMachine(patch).catch((e: unknown) =>
        useToasts.getState().show({
            id: 'keep-awake-save',
            kind: 'error',
            title: i18next.t('settings:agents.keepAwake.saveFailed'),
            description: e instanceof Error ? e.message : i18next.t('settings:machine.toast.unchanged')
        })
    );
};

const OFF: KeepAwakeSettings = { keepAwake: 'off', keepAwakeOnBattery: false, keepAwakeDisplay: false };

const isOff = (settings: KeepAwakeSettings): boolean =>
    settings.keepAwake === OFF.keepAwake && settings.keepAwakeOnBattery === OFF.keepAwakeOnBattery && settings.keepAwakeDisplay === OFF.keepAwakeDisplay;

/*
 * What this client kept from before the machine held keep awake goes to the machine once and is then
 * dropped here. Only onto a machine still at its defaults: one a phone already set keeps what it has.
 * Returns what to send, or null for nothing.
 */
export const keepAwakeToMove = (info: ServerInfo, settings: KeepAwakeSettings): KeepAwakeSettings | null => {
    if (!machineKeepsAwake(info) || isOff(settings)) {
        return null;
    }
    const onMachine = { keepAwake: info.keepAwake ?? OFF.keepAwake, keepAwakeOnBattery: info.keepAwakeOnBattery, keepAwakeDisplay: info.keepAwakeDisplay };
    return isOff(onMachine) ? settings : OFF;
};

/* Moves the old setting over as soon as this computer's machine says it holds keep awake. Returns the unsubscribe. */
export const startKeepAwakeMove = (): (() => void) => {
    let moving = false;
    const check = (): void => {
        if (moving || !hasLocalMachine()) {
            return;
        }
        const settings = useSettings.getState();
        const move = keepAwakeToMove(localInfo(), settings);
        if (move === null) {
            return;
        }
        moving = true;
        const send = isOff(move) ? Promise.resolve() : saveOnMachine(move);
        void send
            .then(() => useSettings.getState().update(OFF))
            .catch(() => undefined)
            .finally(() => {
                moving = false;
            });
    };
    const off = useServers.subscribe(check);
    check();
    return off;
};

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
        // The machine holds its own block, so the shell lets go of the one this window asked for.
        const wanted = machineKeepsAwake(localInfo()) ? null : keepAwakeWanted(useSettings.getState(), useSessions.getState().byKey, useChats.getState().byKey);
        if (sameRequest(wanted, held)) {
            return;
        }
        held = wanted;
        tell(wanted);
    };

    const offSessions = useSessions.subscribe(check);
    const offChats = useChats.subscribe(check);
    const offSettings = useSettings.subscribe(check);
    const offServers = useServers.subscribe(check);
    // `always` holds from the start, before any store has moved.
    check();
    return () => {
        offSessions();
        offChats();
        offSettings();
        offServers();
        if (held !== null) {
            held = null;
            tell(null);
        }
    };
};
