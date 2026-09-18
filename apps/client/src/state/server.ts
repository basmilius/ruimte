import { create } from 'zustand';
import type { EndpointNameSource, ProjectIconChoice, Reachability } from '@ruimte/contracts';
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
    /* Whether a person chose that name or it is the one the machine starts with; null until it answers. */
    nameSource: EndpointNameSource | null;
    /* The icon a person gave this machine, from the set a project and a view pick from. */
    icon: ProjectIconChoice | null;
    /* Whether an agent on this machine may remove a view it did not make. The daemon enforces it, so
       this is only what the Machines pane stands at; false for a daemon that predates the setting. */
    agentsDeleteAnyView: boolean;
    /* Whether this machine turns away a statement from the address book, so only a pairing link lets a
       client in. Enforced by the daemon; false for a daemon that predates statements. */
    refuseStatements: boolean;
    /* Whether the daemon permits browser and device streaming; null for a daemon without the setting. */
    streamingAllowed: boolean | null;
    /* The broker a person picked for this machine; null for a daemon that predates the setting. */
    broker: BrokerSetting | null;
    /* Whether a flag or the environment on the machine decides the broker, which leaves the setting without effect. */
    brokerFixed: boolean;
    reachability: Reachability | null;
    /* The key the machine announces, which the record on an account carries; null until it answers. */
    publicKey: string | null;
}

/* One object for a machine that has not said hello yet, so a selector gets a stable snapshot. */
const UNKNOWN: ServerInfo = {
    platform: null,
    home: null,
    version: null,
    model: null,
    label: null,
    nameSource: null,
    icon: null,
    agentsDeleteAnyView: false,
    refuseStatements: false,
    streamingAllowed: null,
    broker: null,
    brokerFixed: false,
    reachability: null,
    publicKey: null
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
            | 'refuseStatements'
            | 'streamingAllowed'
            | 'broker'
            | 'brokerFixed'
            | 'reachability'
            | 'publicKey'
        >
    ): void;
    /* What someone set on this machine, from `endpoint.changed` or from setting it here. A switch left out stays where it stands. */
    setIdentity(
        endpointId: string,
        info: Pick<ServerInfo, 'label' | 'nameSource' | 'icon' | 'agentsDeleteAnyView'> &
            Partial<Pick<ServerInfo, 'refuseStatements' | 'streamingAllowed' | 'broker' | 'brokerFixed'>>
    ): void;
    /* A machine that is forgotten takes what it said about itself with it. */
    forget(endpointId: string): void;
}

/* What every daemon this client talked to said about itself. */
export const useServers = create<ServersStore>((set, get) => ({
    byEndpoint: {},
    setInfo(endpointId, info) {
        const current = get().byEndpoint[endpointId] ?? UNKNOWN;
        set({ byEndpoint: { ...get().byEndpoint, [endpointId]: { ...current, ...info } } });
    },
    setEndpoint(endpointId, info) {
        const current = get().byEndpoint[endpointId] ?? UNKNOWN;
        set({ byEndpoint: { ...get().byEndpoint, [endpointId]: { ...current, ...info } } });
    },
    setIdentity(endpointId, info) {
        const current = get().byEndpoint[endpointId] ?? UNKNOWN;
        set({ byEndpoint: { ...get().byEndpoint, [endpointId]: { ...current, ...info } } });
    },
    forget(endpointId) {
        const { [endpointId]: _gone, ...rest } = get().byEndpoint;
        set({ byEndpoint: rest });
    }
}));

/* What the machine in scope said about itself, read the way a component asks for one field. */
export const useServer = <T>(select: (info: ServerInfo) => T): T => {
    const endpointId = useEndpointId();
    return useServers((s) => select(s.byEndpoint[endpointId] ?? UNKNOWN));
};

/* The same answer outside a render. */
export const serverInfoOf = (endpointId: string): ServerInfo => useServers.getState().byEndpoint[endpointId] ?? UNKNOWN;

/* What the daemon's machine calls its file manager; the daemon runs it, so its platform decides. */
export const fileManagerName = (platform: string | null): string => {
    switch (platform) {
        case 'darwin':
            return 'Finder';
        case 'win32':
            return 'Explorer';
        default:
            return 'Files';
    }
};
