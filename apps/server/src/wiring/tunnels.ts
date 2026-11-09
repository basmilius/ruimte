import { randomBytes, randomInt } from 'node:crypto';
import { callerFolders } from '../agents/caller-folders.ts';
import { ClientSinks } from '../client-sinks.ts';
import type { ServerConfig } from '../config.ts';
import { deniedRuimtePorts } from '../ports/reserved-ports.ts';
import { shotFolders } from '../shots.ts';
import type { CanvasHost } from '../tools/host.ts';
import { approvalTools } from '../tunnels/approvals.ts';
import { realMetadataPorts } from '../tunnels/client-metadata-real.ts';
import { fetchClientMetadata } from '../tunnels/client-metadata.ts';
import { FileTokenStore } from '../tunnels/cloudflare-token-store.ts';
import { CloudflaredInstaller } from '../tunnels/cloudflared-installer.ts';
import { realInstallerPorts } from '../tunnels/cloudflared-real.ts';
import { spawnRunner } from '../tunnels/cloudflared-runner.ts';
import { ConsentBook } from '../tunnels/consent-book.ts';
import { CredentialStore } from '../tunnels/credential-store.ts';
import { FailureLimiter } from '../tunnels/external-gate.ts';
import { externalHandler, ExternalListener } from '../tunnels/external-listener.ts';
import { TunnelProposals } from '../tunnels/tunnel-proposals.ts';
import { TunnelService } from '../tunnels/tunnel-service.ts';
import { tunnelsFolder, tunnelStore } from '../tunnels/tunnel-store.ts';
import type { AgentStores, AgentsBundle } from './agents.ts';
import { approvalPorts } from './approvals.ts';
import type { ArtifactsBundle } from './artifacts.ts';
import type { LaunchesBundle } from './launches.ts';
import type { ProcessesBundle } from './processes.ts';
import type { ProjectsBundle } from './projects.ts';
import type { RoutinesBundle } from './routines.ts';

/* Tunnels, the credentials of external MCP clients and the listener they reach. */
export interface TunnelsBundle {
    service: TunnelService;
    /* The cards in which an agent suggests a change to a hostname, which only a person's confirm makes. */
    proposals: TunnelProposals;
    credentials: CredentialStore;
    consent: ConsentBook;
    listener: ExternalListener;
    /* What every client hears: the tunnel state or the consent waiting for a person moved. */
    sinks: ClientSinks;
    /* The ports Ruimte listens on or reserves, which neither a tunnel row nor a shared port may name; read at every check. */
    deniedPorts(): number[];
}

interface TunnelsInput {
    config: ServerConfig;
    canvasHost: CanvasHost;
    agents: AgentsBundle;
    projects: ProjectsBundle;
    processes: ProcessesBundle;
    artifacts: ArtifactsBundle;
    stores: Pick<AgentStores, 'modeApprovals'>;
    launches: Pick<LaunchesBundle, 'store' | 'agentHost'>;
    routines: Pick<RoutinesBundle, 'routines'>;
    machineId: string;
    /* Called when an external client is used after a minute of quiet, so the list of connected clients reads again. */
    externalUsed?(): void;
    /* The port the API answers on, which is not `config.port` when the system picked one. */
    later: { apiPort(): number };
}

export async function wireTunnels(input: TunnelsInput): Promise<TunnelsBundle> {
    const { config, canvasHost, agents, projects, processes, artifacts, stores, launches, routines, machineId, later } = input;
    const sinks = new ClientSinks();
    let proposals: TunnelProposals | null = null;
    const changed = (): void => {
        sinks.emit({ event: 'tunnel.changed', payload: {} });
        // A row that moved may leave a card standing for something else.
        proposals?.refresh();
    };
    const consentChanged = (): void => sinks.emit({ event: 'consent.changed', payload: {} });
    const credentials = new CredentialStore({
        home: config.home,
        now: Date.now,
        random: (bytes) => randomBytes(bytes).toString('base64url'),
        used: () => {
            changed();
            input.externalUsed?.();
        }
    });
    await credentials.load();
    const consent = new ConsentBook({
        now: Date.now,
        random: (bytes) => randomBytes(bytes).toString('base64url'),
        pick: (limit) => randomInt(limit),
        changed: consentChanged
    });
    const limiter = new FailureLimiter(Date.now);
    let listener!: ExternalListener;
    const handler = externalHandler({
        credentials,
        consent,
        limiter,
        mcp: {
            host: canvasHost,
            uploads: artifacts.artifacts,
            callerFolders: (caller) => callerFolders(config.home, caller),
            shotFolders: shotFolders(config.home),
            extraTools: approvalTools(approvalPorts({ stores, agents, projects, launches, routines }))
        },
        fetchMetadata: (clientId) => fetchClientMetadata(clientId, realMetadataPorts()),
        now: Date.now,
        port: () => listener.port
    });

    listener = new ExternalListener(handler, config.externalPort);

    // The API, the door on the local network and the listener itself: a dev server row or a shared port never points at Ruimte.
    const deniedPorts = (): number[] =>
        deniedRuimtePorts([later.apiPort(), config.lanPort, config.externalPort, listener.port].filter((port): port is number => port !== null && port > 0));

    const service = new TunnelService({
        store: tunnelStore(config.home),
        installer: new CloudflaredInstaller(tunnelsFolder(config.home), realInstallerPorts()),
        runner: spawnRunner,
        tokens: new FileTokenStore(config.home),
        cloudflare: (url, init) => fetch(url, init),
        machineName: () => config.label,
        machineId: () => machineId,
        deniedPorts,
        setListener: async (enabled) => {
            if (enabled) {
                listener.start();
            } else {
                listener.stop();
            }

            return listener.port;
        },
        listenerPort: () => listener.port,
        clients: () => credentials.recentlyUsed(),
        discover: async () => {
            const found: Array<{ port: number; session: string | null }> = [];

            for (const session of agents.sessions.list()) {
                const result = await processes.sessionPorts.list(session.sessionId).catch(() => null);

                if (result?.status === 'ready') {
                    found.push(...result.ports.map((entry) => ({ port: entry.port, session: projects.store.index.titleFor(session.sessionId) })));
                }
            }

            return found;
        },
        changed,
        random: (bytes) => randomBytes(bytes).toString('hex'),
        log: (line) => console.log(line)
    });
    const cards = new TunnelProposals({
        tunnels: service,
        chats: { hold: (chatId, key) => void agents.chats.holdForPerson(chatId, key), release: (chatId, key) => agents.chats.releaseHold(chatId, key) },
        publish: (list) => sinks.emit({ event: 'tunnel.proposals', payload: { proposals: list } })
    });

    proposals = cards;
    canvasHost.tunnels = {
        state: () => service.state(),
        rowsAsMeant: () => service.rowsAsMeant(),
        zoneOf: (hostname) => service.zoneOf(hostname),
        propose: (ask) => cards.ask(ask),
        of: (chatId) => cards.of(chatId)
    };

    return { service, proposals: cards, credentials, consent, listener, sinks, deniedPorts };
}
