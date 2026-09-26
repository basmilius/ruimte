import { AGENT_REQUEST_SCHEMAS, parseRequest, type AgentRequestType, type FramePort, type ReplyError } from '@ruimte/agent-contracts';
import type { ChatCore } from '../chat/chat-core.ts';
import { CodedError } from '../coded-error.ts';
import { errorText } from '../error-text.ts';
import type { ProviderAccountsService } from '../providers/accounts/service.ts';
import type { ProviderRegistry } from '../providers/registry.ts';
import type { UsageMonitor } from '../usage/limits/monitor.ts';
import type { UsageService } from '../usage/usage-service.ts';
import type { AgentHandler } from './handlers.ts';
import { wireAgents, type AgentWiring, type AgentWiringOptions } from './wiring.ts';

export interface AgentHostOptions<Core extends ChatCore = ChatCore> extends AgentWiringOptions<Core> {
    // Whether the host checks who is signed in and reads what is left of each plan on its own clock.
    background?: boolean;
}

const errorReply = (id: string | null, code: string, message: string): ReplyError => ({ id, ok: false, error: { code, message } });

const isAgentRequest = (type: string): type is AgentRequestType => Object.hasOwn(AGENT_REQUEST_SCHEMAS, type);

/*
 * The chats of an app that has no daemon: it answers the agent requests over any `FramePort` and
 * sends the agent events back on it, frames checked on arrival the way Ruimte's daemon checks a
 * socket's. One port is one client. Closing the host writes every thread and ends every CLI; a chat
 * goes on at the next start through its CLI's own session.
 */
export class AgentHost<Core extends ChatCore = ChatCore> {
    readonly chats: Core;
    readonly providers: ProviderRegistry;
    readonly accounts: ProviderAccountsService;
    readonly usage: UsageService;
    readonly limits: UsageMonitor;
    private readonly wiring: AgentWiring<Core>;
    private readonly background: boolean;
    private readonly connections = new Set<() => void>();
    private nextClient = 1;
    private closing: Promise<void> | null = null;

    private constructor(options: AgentHostOptions<Core>) {
        this.wiring = wireAgents(options);
        this.chats = this.wiring.chats;
        this.providers = this.wiring.providers;
        this.accounts = this.wiring.accounts;
        this.usage = this.wiring.usage;
        this.limits = this.wiring.limits;
        this.background = options.background ?? true;
    }

    /* A host with its accounts read; its clocks run from here unless `background` is off. */
    static async open<Core extends ChatCore = ChatCore>(options: AgentHostOptions<Core>): Promise<AgentHost<Core>> {
        const host = new AgentHost(options);
        await host.accounts.load();
        if (host.background) {
            host.wiring.start();
        }
        return host;
    }

    /* Serves one client over `port` until the returned function or `close` lets go of it. */
    connect(port: FramePort): () => void {
        const clientId = `port-${this.nextClient++}`;
        const releases = [
            port.onFrame((frame) => void this.receive(port, clientId, frame)),
            this.wiring.connect(clientId, (event) => port.send({ type: 'event', event: event.event, payload: event.payload }))
        ];
        const disconnect = (): void => {
            if (!this.connections.delete(disconnect)) {
                return;
            }
            for (const release of releases) {
                release();
            }
        };
        this.connections.add(disconnect);
        return disconnect;
    }

    /* Lets go of every client, writes every thread and ends every CLI; settles once they exited. */
    close(): Promise<void> {
        this.closing ??= this.shutDown();
        return this.closing;
    }

    private async shutDown(): Promise<void> {
        for (const disconnect of [...this.connections]) {
            disconnect();
        }
        await this.wiring.stop();
    }

    private async receive(port: FramePort, clientId: string, frame: unknown): Promise<void> {
        const parsed = parseRequest(frame);
        if (!parsed.ok) {
            // The id when the frame carried a usable one, so the client can settle its promise.
            const id = typeof frame === 'object' && frame !== null && 'id' in frame && typeof frame.id === 'string' && frame.id !== '' ? frame.id : null;
            port.send(errorReply(id, 'bad-request', parsed.message));
            return;
        }
        const { id, type, payload } = parsed.value;
        if (!isAgentRequest(type)) {
            port.send(errorReply(id, 'unknown-request', `Unknown request type: ${type}`));
            return;
        }
        const checked = AGENT_REQUEST_SCHEMAS[type].payload.safeParse(payload);
        if (!checked.success) {
            port.send(errorReply(id, 'bad-request', `Invalid payload for ${type}`));
            return;
        }
        try {
            const handler = this.wiring.handlers[type] as AgentHandler<AgentRequestType>;
            port.send({ id, ok: true, result: await handler(checked.data as never, clientId) });
        } catch (e) {
            if (e instanceof CodedError) {
                port.send(errorReply(id, e.code, e.message));
                return;
            }
            console.error(`Handler for ${type} failed:`, errorText(e));
            port.send(errorReply(id, 'internal', 'Request failed'));
        }
    }
}
