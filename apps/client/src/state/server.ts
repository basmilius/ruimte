import { create } from 'zustand';
import type { AgentIntegrationsSummary, EndpointNameSource, KeepAwakeMode, MachineUpdate, NodeSizes, ProjectIconChoice, Reachability } from '@ruimte/contracts';
import type { BrokerSetting } from '@ruimte/pulsar';
import { useEndpointId } from '@/state/keys';

export interface ServerInfo {
    /* The daemon's platform (`darwin`, `win32`, `linux`); null until the first hello. */
    platform: string | null;
    home: string | null;
    version: string | null;
    /* What the machine's hardware is called ("MacBook Pro"); null when the daemon could not read it. */
    model: string | null;
    /* How the daemon names itself and how far away it is, from `endpoint.info`. */
    label: string | null;
    /* Whether a person chose that name or it is the one the machine starts with. */
    nameSource: EndpointNameSource;
    /* The icon a person gave this machine, from the set a project and a view pick from; null while nobody picked one. */
    icon: ProjectIconChoice | null;
    /* Whether an agent on this machine may remove a view it did not make. The daemon enforces it, so
       this is only what the Machines pane stands at. */
    agentsDeleteAnyView: boolean;
    /* Whether an agent on this machine may reach its other open projects. The daemon enforces it. */
    reachOpenProjects: boolean;
    /* Whether the daemon permits browser and device streaming. */
    streamingAllowed: boolean;
    /* Whether a chat that stopped on a limit may be taken up again on a clock. */
    resumeAtReset: boolean;
    /* Whether an agent may show a page above its reply. */
    visualReplies: boolean;
    appleFoundationEnabled: boolean;
    /* When the machine keeps itself awake. */
    keepAwake: KeepAwakeMode;
    keepAwakeOnBattery: boolean;
    keepAwakeDisplay: boolean;
    /* Whether the machine can hold a block on sleep at all. */
    keepAwakeAvailable: boolean;
    /* Also with the lid closed, which turns sleep off while the block holds. */
    keepAwakeLidClosed: boolean;
    /* Whether the machine offers the closed-lid mode at all, which only a Mac does. */
    keepAwakeLidAvailable: boolean;
    /* Whether the sudoers rule the closed-lid mode needs is installed on the machine. */
    keepAwakeLidRule: boolean;
    /* Where the update of the desktop app on the machine stands; null while it reports none. */
    update: MachineUpdate | null;
    /* The broker a person picked for this machine. */
    broker: BrokerSetting;
    /* Whether a flag or the environment on the machine decides the broker, which leaves the setting without effect. */
    brokerFixed: boolean;
    /* Whether a person keeps the machine's door on the local network open. */
    lanDoor: boolean;
    /* Whether a flag on the machine decides the door, which leaves the setting without effect. */
    lanDoorFixed: boolean;
    /* What a person allowed in the CLIs' global settings; null while the machine has not said. */
    agentIntegrations: AgentIntegrationsSummary | null;
    reachability: Reachability | null;
    /* The key the machine announces, which the record on an account carries; null until it answers. */
    publicKey: string | null;
    /* The account the machine is on, null for none. Only the app on the machine is told, so it is
       undefined for any other machine. */
    accountId: string | null | undefined;
    /* The folder new worktrees are made in, null for the data folder. Only the app on the machine is told; undefined for any other. */
    worktreeRoot: string | null | undefined;
    /* The sizes a person gave new nodes of a kind on the machine, only the kinds they changed. */
    nodeSizes: NodeSizes;
    /* Whether the machine sends its anonymous usage counts; undefined from a machine without the switch. */
    usageStats: boolean | undefined;
    /* Whether the machine resolves `references` on `chat.send`; without it a `#` reaches only chats. */
    viewReferences: boolean;
}

/* One object for a machine that has not said hello yet, so a selector gets a stable snapshot. Its settings are the daemon's own defaults. */
const UNKNOWN: ServerInfo = {
    platform: null,
    home: null,
    version: null,
    model: null,
    label: null,
    nameSource: 'default',
    icon: null,
    agentsDeleteAnyView: false,
    reachOpenProjects: false,
    streamingAllowed: true,
    resumeAtReset: false,
    visualReplies: true,
    appleFoundationEnabled: false,
    keepAwake: 'off',
    keepAwakeOnBattery: false,
    keepAwakeDisplay: false,
    keepAwakeAvailable: false,
    keepAwakeLidClosed: false,
    keepAwakeLidAvailable: false,
    keepAwakeLidRule: false,
    update: null,
    broker: { mode: 'default' },
    brokerFixed: false,
    lanDoor: true,
    lanDoorFixed: false,
    agentIntegrations: null,
    reachability: null,
    publicKey: null,
    accountId: undefined,
    worktreeRoot: undefined,
    nodeSizes: {},
    usageStats: undefined,
    viewReferences: false
};

interface ServersStore {
    byEndpoint: Record<string, ServerInfo>;
    setInfo(endpointId: string, info: Pick<ServerInfo, 'platform' | 'home' | 'version' | 'model'>): void;
    setEndpoint(
        endpointId: string,
        info: Pick<
            ServerInfo,
            | 'label'
            | 'nameSource'
            | 'icon'
            | 'agentsDeleteAnyView'
            | 'reachOpenProjects'
            | 'streamingAllowed'
            | 'resumeAtReset'
            | 'visualReplies'
            | 'appleFoundationEnabled'
            | 'keepAwake'
            | 'keepAwakeOnBattery'
            | 'keepAwakeDisplay'
            | 'keepAwakeAvailable'
            | 'keepAwakeLidClosed'
            | 'keepAwakeLidAvailable'
            | 'keepAwakeLidRule'
            | 'update'
            | 'broker'
            | 'brokerFixed'
            | 'lanDoor'
            | 'lanDoorFixed'
            | 'agentIntegrations'
            | 'reachability'
            | 'publicKey'
            | 'accountId'
            | 'worktreeRoot'
            | 'nodeSizes'
            | 'usageStats'
            | 'viewReferences'
        >
    ): void;
    /* What a person allowed in the CLIs' settings, after this client changed it. */
    setAgentIntegrations(endpointId: string, summary: AgentIntegrationsSummary): void;
    /* The account the machine is on now, after this client put it on one or took it off. */
    setAccount(endpointId: string, accountId: string | null): void;
    /* What someone set on this machine, from `endpoint.changed` or from setting it here. A switch left out stays where it stands. */
    setIdentity(
        endpointId: string,
        info: Pick<ServerInfo, 'label' | 'nameSource' | 'icon' | 'agentsDeleteAnyView'> &
            Partial<
                Pick<
                    ServerInfo,
                    | 'reachOpenProjects'
                    | 'streamingAllowed'
                    | 'resumeAtReset'
                    | 'visualReplies'
                    | 'appleFoundationEnabled'
                    | 'keepAwake'
                    | 'keepAwakeOnBattery'
                    | 'keepAwakeDisplay'
                    | 'keepAwakeLidClosed'
                    | 'keepAwakeLidRule'
                    | 'broker'
                    | 'brokerFixed'
                    | 'lanDoor'
                    | 'lanDoorFixed'
                    | 'agentIntegrations'
                    | 'worktreeRoot'
                    | 'nodeSizes'
                    | 'usageStats'
                >
            >
    ): void;
    /* The update of the desktop app on the machine moved on, from `endpoint.updateChanged`. */
    setUpdate(endpointId: string, update: MachineUpdate): void;
    /* A machine that is forgotten takes what it said about itself with it. */
    forget(endpointId: string): void;
}

/* What every daemon this client talked to said about itself. */
export const useServers = create<ServersStore>((set, get) => {
    const merge = (endpointId: string, patch: Partial<ServerInfo>): void => {
        const current = get().byEndpoint[endpointId] ?? UNKNOWN;
        set({ byEndpoint: { ...get().byEndpoint, [endpointId]: { ...current, ...patch } } });
    };
    return {
        byEndpoint: {},
        setInfo: merge,
        setEndpoint: merge,
        setAgentIntegrations(endpointId, summary) {
            merge(endpointId, { agentIntegrations: summary });
        },
        setAccount(endpointId, accountId) {
            merge(endpointId, { accountId });
        },
        setIdentity: merge,
        setUpdate(endpointId, update) {
            merge(endpointId, { update });
        },
        forget(endpointId) {
            const { [endpointId]: _gone, ...rest } = get().byEndpoint;
            set({ byEndpoint: rest });
        }
    };
});

/* What the machine in scope said about itself, read the way a component asks for one field. */
export function useServer<T>(select: (info: ServerInfo) => T): T {
    const endpointId = useEndpointId();
    return useServers((s) => select(s.byEndpoint[endpointId] ?? UNKNOWN));
}

/* The same answer outside a render. */
export function serverInfoOf(endpointId: string): ServerInfo {
    return useServers.getState().byEndpoint[endpointId] ?? UNKNOWN;
}

/* What the daemon's machine calls its file manager; the daemon runs it, so its platform decides. */
export function fileManagerName(platform: string | null): string {
    switch (platform) {
        case 'darwin':
            return 'Finder';
        case 'win32':
            return 'Explorer';
        default:
            return 'Files';
    }
}
