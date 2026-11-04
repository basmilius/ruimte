import type { SecretRequest } from '@ruimte/contracts';
import { ClientSinks } from '../client-sinks.ts';
import { errorText } from '../error-text.ts';
import type { SessionEvent, SessionSink } from '../sessions/manager.ts';
import type { Timers } from '../timers.ts';
import { SecretRequests, type SecretAsk, type SecretChats, type SecretOutcome } from './secret-requests.ts';
import type { SecretSlot, SecretStore } from './secret-store.ts';

/* What a Save changes on the launch: the variable becomes a reference to the stored secret. */
interface SecretLaunches {
    bindSecret(projectId: string, launchId: string, variable: string): Promise<void>;
}

/*
 * The secrets of launches as the daemon wires them: the cards every client hears, a person's answer,
 * and what ends a card besides an answer. A Save writes the value first and binds it second, and a
 * value that was not there before goes again when the binding fails, so a failed Save leaves nothing.
 */
export class SecretService {
    private readonly store: Pick<SecretStore, 'has' | 'write' | 'remove'>;
    private readonly launches: SecretLaunches;
    private readonly sinks = new ClientSinks();
    private readonly requests: SecretRequests;

    constructor(options: {
        store: Pick<SecretStore, 'has' | 'write' | 'remove'>;
        launches: SecretLaunches;
        chats: SecretChats;
        now?: () => number;
        timers?: Timers;
        cardMs?: number;
    }) {
        this.store = options.store;
        this.launches = options.launches;
        this.requests = new SecretRequests({
            sink: { has: (projectId, slot) => this.store.has(projectId, slot), save: (projectId, slot, value) => this.keep(projectId, slot, value) },
            chats: options.chats,
            publish: (requests) => this.sinks.emit({ event: 'secret.requests', payload: { requests } }),
            ...(options.now ? { now: options.now } : {}),
            ...(options.timers ? { timers: options.timers } : {}),
            ...(options.cardMs === undefined ? {} : { cardMs: options.cardMs })
        });
    }

    subscribe(clientId: string, sink: SessionSink): () => void {
        return this.sinks.subscribe(clientId, sink);
    }

    ask(ask: SecretAsk, waitMs?: number): Promise<{ requestId: string; outcome: SecretOutcome }> {
        return this.requests.ask(ask, waitMs);
    }

    list(): SecretRequest[] {
        return this.requests.list();
    }

    save(requestId: string, value: string): Promise<boolean> {
        return this.requests.save(requestId, value);
    }

    decline(requestId: string): boolean {
        return this.requests.decline(requestId);
    }

    /* A turn that ends or a chat that stops takes its cards down. */
    observe(event: SessionEvent): void {
        if (event.event !== 'chat.event') {
            return;
        }
        const { chatId, event: chat } = event.payload;
        if (chat.type === 'item' && chat.item.kind === 'turn' && chat.item.state !== 'running') {
            this.requests.turnEnded(chatId);
        } else if ((chat.type === 'info' || chat.type === 'reset') && chat.info.status === 'exited') {
            this.requests.forget(chatId);
        }
    }

    nodeClosed(nodeId: string): void {
        this.requests.forget(nodeId);
    }

    private async keep(projectId: string, slot: SecretSlot, value: string): Promise<void> {
        const existed = await this.store.has(projectId, slot);
        await this.store.write(projectId, slot, value);
        try {
            await this.launches.bindSecret(projectId, slot.launchId, slot.variable);
        } catch (e) {
            if (!existed) {
                await this.store
                    .remove(projectId, slot)
                    .catch((removal: unknown) => console.warn(`Taking back a secret failed: ${slot.variable} of ${projectId},`, errorText(removal)));
            }
            throw e;
        }
    }
}
