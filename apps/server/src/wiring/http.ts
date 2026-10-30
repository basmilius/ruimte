import type { Server } from 'bun';
import {
    MACHINE_HEALTH_PATH,
    MACHINE_NOTIFY_PATH,
    MACHINE_PROOF_PATH,
    MACHINE_STATUS_CHECK_QUERY,
    MACHINE_SHUTDOWN_PATH,
    MACHINE_STATUS_PATH,
    MACHINE_VOICE_KEY_PATH,
    MACHINE_WORK_PATH,
    PROTOCOL_PARAM,
    PROTOCOL_REFUSED_CLOSE_CODE,
    acceptsOfferedProtocol,
    protocolRefusalReason,
    type HealthResult,
    type MachineStatus
} from '@ruimte/contracts';
import { AccountSchema } from '@ruimte/pulsar';
import { z } from 'zod';
import { HOOKS_PATH, handleHookRequest } from '../agents/hook-receiver.ts';
import { crossOriginHeaders, decideAccess, handleLocalTicketRequest, isOwner, preflightHeaders, withHeaders } from '../auth/access.ts';
import { handleLocalProofRequest } from '../auth/local-proof.ts';
import { MachineAccountError, signForAccount, signLinkRequest } from '../auth/registration.ts';
import { SOCKET_BACKPRESSURE_LIMIT } from '../backpressure.ts';
import { ARTIFACT_UPLOAD_BODY_BYTES, ARTIFACT_UPLOAD_PATH, handleArtifactUpload } from '../canvas/artifact-upload-route.ts';
import { CANVAS_PATH, CANVAS_REQUEST_TIMEOUT_S, handleCanvasRequest } from '../canvas/canvas-route.ts';
import type { CanvasHost } from '../canvas/verb.ts';
import { ATTACHMENTS_PATH, handleAttachmentRequest } from '../chat/attachment-route.ts';
import { socketChannel } from '../connection.ts';
import { hookContext } from '../context/context-note.ts';
import { handleContextRequest } from '../context/context-route.ts';
import { CONTEXT_PATH } from '../context/context-store.ts';
import type { ClientAccess } from '../dispatcher.ts';
import { FS_FILE_PATH, handleFsFileRequest } from '../fs/file-route.ts';
import { PAIRING_REMOVED } from '../handlers/auth.ts';
import { answerRoute, type Route } from '../http-routes.ts';
import { handleProjectRequest, PROJECTS_PATH } from '../projects/icon-route.ts';
import { handleMachineNotify } from '../push/notify-route.ts';
import { takesNoteOnLine } from '../providers/launch.ts';
import { handleLiveStreamRequest, LIVE_STREAM_PATH } from '../streams/http-stream.ts';
import { BUILD, VERSION } from '../version.ts';
import type { AgentStores, AgentsBundle } from './agents.ts';
import type { ArtifactsBundle } from './artifacts.ts';
import type { ClientsBundle } from './clients.ts';
import type { DevicesBundle } from './devices.ts';
import type { MachineBundle } from './machine.ts';
import type { NetworkBundle } from './network.ts';
import type { PowerBundle } from './power.ts';
import type { ProjectsBundle } from './projects.ts';
import type { DaemonRuntime } from './runtime.ts';
import type { ProcessesBundle } from './processes.ts';
import type { VoiceBundle } from './voice.ts';

// What `ruimte login` has the machine sign; local secret only, like the work.
const MACHINE_LINK_PATH = '/machine/link-request';
const MACHINE_REGISTRATION_PATH = '/machine/registration';
// What `ruimte logout` asks: the machine leaves its account, as `endpoint.leaveAccount` does for the app.
const MACHINE_LEAVE_ACCOUNT_PATH = '/machine/leave-account';
// Where a client of before account-only paired and signed for a ticket over HTTP; each answers that pairing links are gone.
const LEGACY_PAIRING_PATHS = ['/auth/pair', '/auth/pairing-token', '/auth/challenge', '/auth/ticket'];
const RegistrationRequestSchema = z.object({ accountId: AccountSchema.shape.id });
const VoiceKeyRequestSchema = z.object({ key: z.string() });

// Past anything a hook or a verb sends, a visual of 16 MiB with its JSON escaping included, and what any other request may declare.
const MAX_REQUEST_BODY_BYTES = 24 * 1024 * 1024;
// A model an agent attaches, 50 MiB as base64 with its other words; the verb route checks the token before it reads the body. Also the server's ceiling.
const MAX_VERB_BODY_BYTES = 72 * 1024 * 1024;

export type SocketData = ClientAccess & { protocolRefused: boolean; ticket: string | null };

interface HttpInput {
    requestStop: () => void;
    runtime: DaemonRuntime;
    machine: MachineBundle;
    stores: AgentStores;
    agents: AgentsBundle;
    projects: ProjectsBundle;
    devices: DevicesBundle;
    processes: ProcessesBundle;
    power: PowerBundle;
    network: NetworkBundle;
    clients: ClientsBundle;
    canvasHost: CanvasHost;
    voice: VoiceBundle;
    artifacts: ArtifactsBundle;
}

/* Every HTTP route and the upgrade, before the cross-origin headers the desktop app's page needs. */
function daemonRoutes(input: HttpInput): Route<SocketData>[] {
    const { runtime, machine, stores, agents, projects, devices, processes, power, network, clients, canvasHost, voice } = input;
    const { config } = runtime;
    const { identity, auth, handshake, access, machineHome } = machine;
    const { sessions, chats, context } = agents;
    const { brokerSwitch } = network;
    // What a route only the local secret reaches answers before it does anything: null to go on.
    const refuseUnlessOwner = async (request: Request, remote: string, method: 'GET' | 'POST'): Promise<Response | null> => {
        if (request.method !== method) {
            return new Response('Method not allowed', { status: 405 });
        }
        const decision = await decideAccess(request, remote, access, 'local');
        return decision.ok && isOwner(decision.access) ? null : new Response('Forbidden', { status: 403 });
    };
    return [
        {
            exact: [MACHINE_HEALTH_PATH],
            handle: ({ request }) => {
                if (request.method !== 'GET') {
                    return new Response('Method not allowed', { status: 405 });
                }
                return Response.json({ ok: true, version: VERSION, build: BUILD, service: config.underService } satisfies HealthResult);
            }
        },
        {
            exact: [MACHINE_PROOF_PATH],
            handle: ({ request, server }) => handleLocalProofRequest(request, { localSecret: access.localSecret, port: server.port ?? config.port })
        },
        // todo(bas): drop with `PAIRING_REMOVED` one release after pairing links went.
        { exact: LEGACY_PAIRING_PATHS, handle: () => new Response(PAIRING_REMOVED, { status: 410 }) },
        { exact: ['/auth/local-ticket'], handle: ({ request }) => handleLocalTicketRequest(request, access, handshake) },
        {
            exact: [MACHINE_WORK_PATH],
            // The desktop app asks before it restarts the service, and nobody else needs to know.
            handle: async ({ request, remote }) => (await refuseUnlessOwner(request, remote, 'GET')) ?? Response.json(processes.machineWork())
        },
        {
            exact: [MACHINE_VOICE_KEY_PATH],
            handle: async ({ request, remote }) => {
                const refused = await refuseUnlessOwner(request, remote, 'POST');
                if (refused) {
                    return refused;
                }
                const parsed = VoiceKeyRequestSchema.safeParse(await request.json().catch(() => null));
                if (!parsed.success) {
                    return new Response('Expected a key', { status: 400 });
                }
                try {
                    await voice.keys.write(parsed.data.key);
                } catch (e) {
                    // The store says what is wrong without quoting the key.
                    return new Response(e instanceof Error ? e.message : 'The key could not be saved', { status: 400 });
                }
                return new Response(null, { status: 204 });
            }
        },
        {
            exact: [MACHINE_LEAVE_ACCOUNT_PATH],
            handle: async ({ request, remote }) => {
                const refused = await refuseUnlessOwner(request, remote, 'POST');
                if (refused) {
                    return refused;
                }
                const revoked = await auth.leaveAccount();
                revoked.forEach(clients.disconnectSession);
                return Response.json({ revoked: revoked.length });
            }
        },
        { exact: [MACHINE_NOTIFY_PATH], handle: ({ request, remote }) => handleMachineNotify(request, remote, access, canvasHost.messages) },
        {
            exact: [MACHINE_SHUTDOWN_PATH],
            handle: async ({ request, remote }) => {
                const refused = await refuseUnlessOwner(request, remote, 'POST');
                if (refused) {
                    return refused;
                }
                input.requestStop();
                return new Response(null, { status: 202 });
            }
        },
        {
            exact: [MACHINE_STATUS_PATH],
            // `ruimte status` on the local secret; a client sees the same through `endpoint.info`.
            handle: async ({ request, remote, url }) => {
                const refused = await refuseUnlessOwner(request, remote, 'GET');
                if (refused) {
                    return refused;
                }
                const reach = url.searchParams.has(MACHINE_STATUS_CHECK_QUERY) ? await network.reach.check() : await network.reach.current();
                const binding = await auth.accountBinding();
                const { keepAwake, closedLid } = power;
                return Response.json({
                    version: VERSION,
                    service: config.underService,
                    label: identity.label,
                    onAccount: binding !== undefined && binding !== null,
                    broker: { url: brokerSwitch.describe().brokerUrl, connected: brokerSwitch.isReady },
                    ...network.describeLanDoor(),
                    keepAwake: {
                        mode: identity.keepAwake.mode,
                        onBattery: identity.keepAwake.onBattery,
                        holding: keepAwake.holding,
                        lid: closedLid.available ? { on: identity.keepAwake.lidClosed, rule: await closedLid.refreshRule(), holding: closedLid.holding } : null
                    },
                    reach
                } satisfies MachineStatus);
            }
        },
        {
            exact: [MACHINE_LINK_PATH, MACHINE_REGISTRATION_PATH],
            // `ruimte login` on the local secret: the machine signs, the terminal talks to the address book.
            handle: async ({ request, url, remote }) => {
                const refused = await refuseUnlessOwner(request, remote, 'POST');
                if (refused) {
                    return refused;
                }
                const { brokerUrl } = brokerSwitch.describe();
                if (url.pathname === MACHINE_LINK_PATH) {
                    return Response.json(signLinkRequest(identity, brokerUrl));
                }
                const parsed = RegistrationRequestSchema.safeParse(await request.json().catch(() => null));
                if (!parsed.success) {
                    return new Response('Expected an account id', { status: 400 });
                }
                try {
                    return Response.json(await signForAccount(auth, identity, brokerUrl, parsed.data.accountId, clients.disconnectSession));
                } catch (e) {
                    if (e instanceof MachineAccountError) {
                        return Response.json({ code: e.code, message: e.message }, { status: 409 });
                    }
                    throw e;
                }
            }
        },
        {
            exact: ['/ws'],
            handle: async ({ request, url, remote, server }) => {
                const decision = await decideAccess(request, remote, access, 'socket');
                if (!decision.ok) {
                    return new Response(decision.reason, { status: decision.status });
                }
                // Upgraded and then closed, since a browser reads the code and reason of a close but never the status of a refused upgrade.
                const protocolRefused = !acceptsOfferedProtocol(url.searchParams.get(PROTOCOL_PARAM));
                if (server.upgrade(request, { data: { ...decision.access, protocolRefused, ticket: decision.ticket ?? null } })) {
                    return undefined;
                }
                if (decision.ticket !== undefined) {
                    handshake.socketClosed(decision.ticket);
                }
                return new Response('Expected a WebSocket upgrade', { status: 426 });
            }
        },
        {
            below: ATTACHMENTS_PATH,
            handle: ({ request, url, remote }) => handleAttachmentRequest(request, url, remote, access, (chatId, id) => chats.findAttachment(chatId, id))
        },
        { below: PROJECTS_PATH, handle: ({ request, url, remote }) => handleProjectRequest(request, url, remote, access, projects.store) },
        { exact: [FS_FILE_PATH], handle: ({ request, url, remote }) => handleFsFileRequest(request, url, remote, access, machineHome) },
        {
            below: LIVE_STREAM_PATH,
            handle: ({ request, url, remote }) => handleLiveStreamRequest(request, url, remote, access, devices.liveStreams, () => identity.streamingAllowed)
        },
        {
            below: HOOKS_PATH,
            handle: ({ request, url }) =>
                handleHookRequest(request, url.pathname, sessions, (token, event, kind) => {
                    const sessionId = sessions.sessionIdForToken(token);
                    if (!sessionId) {
                        return null;
                    }
                    // Asked on every event that can carry an answer, so the memory of what this
                    // agent was told keeps up with its turns even where nothing is printed.
                    const changed = context.changeSince(sessionId);
                    // A CLI the node launched got the verbs on its line; one typed by hand in the shell did not.
                    const verbs = !(takesNoteOnLine(kind) && sessions.get(sessionId)?.launch?.kind === kind);
                    return hookContext(event, context.list(sessionId), {
                        changed,
                        messages: agents.messagesFor(sessionId),
                        depth: stores.lineage.depthOf(sessionId),
                        standalone: projects.store.index.locate(sessionId)?.canvasId === null,
                        verbs,
                        computer: devices.computer.usable,
                        reach: identity.reachOpenProjects
                    });
                })
        },
        // Before the verbs, whose prefix it shares: an agent's files arrive here in raw pieces, never in a verb's body.
        {
            below: ARTIFACT_UPLOAD_PATH,
            bodyBytes: ARTIFACT_UPLOAD_BODY_BYTES,
            handle: ({ request, url }) => handleArtifactUpload(request, url, { targetForToken: agents.targetForToken, artifacts: input.artifacts.artifacts })
        },
        {
            below: CANVAS_PATH,
            bodyBytes: MAX_VERB_BODY_BYTES,
            handle: ({ request, url, server }) => {
                server.timeout(request, CANVAS_REQUEST_TIMEOUT_S);
                return handleCanvasRequest(request, url.pathname, { targetForToken: agents.targetForToken, host: canvasHost });
            }
        },
        {
            exact: [CONTEXT_PATH],
            below: CONTEXT_PATH,
            handle: ({ request, url }) => handleContextRequest(request, url.pathname, { targetForToken: agents.targetForToken, host: canvasHost })
        }
    ];
}

/* Starts answering on the daemon's port: every HTTP route, and every client socket from its upgrade to its close. */
export function serveDaemon(input: HttpInput): Server<SocketData> {
    const { config } = input.runtime;
    const { handshake } = input.machine;
    const { sockets, open } = input.clients;
    const routes = daemonRoutes(input);
    return Bun.serve<SocketData>({
        hostname: config.host,
        port: config.port,
        maxRequestBodySize: MAX_VERB_BODY_BYTES,
        async fetch(request, server) {
            const cors = crossOriginHeaders(request);
            if (cors !== null && request.method === 'OPTIONS') {
                return new Response(null, { status: 204, headers: preflightHeaders(cors) });
            }
            const response = await answerRoute(routes, request, server, MAX_REQUEST_BODY_BYTES);
            return cors === null || response === undefined ? response : withHeaders(response, cors);
        },
        websocket: {
            backpressureLimit: SOCKET_BACKPRESSURE_LIMIT,
            closeOnBackpressureLimit: true,
            open(ws) {
                if (ws.data.protocolRefused) {
                    ws.close(PROTOCOL_REFUSED_CLOSE_CODE, protocolRefusalReason());
                    return;
                }
                const channel = socketChannel(ws);
                sockets.set(ws, { channel, connection: open(channel, ws.data) });
            },
            drain(ws) {
                // The socket has room again: every session that lost output gets a fresh screen.
                sockets.get(ws)?.channel.drained();
            },
            message(ws, message) {
                sockets.get(ws)?.connection.receive(message);
            },
            close(ws) {
                if (ws.data.ticket !== null) {
                    handshake.socketClosed(ws.data.ticket);
                }
                const state = sockets.get(ws);
                if (!state) {
                    return;
                }
                sockets.delete(ws);
                state.channel.closed();
            }
        }
    });
}
