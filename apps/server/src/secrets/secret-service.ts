import type { SecretRequest } from '@ruimte/contracts';
import { ClientSinks } from '../client-sinks.ts';
import { errorText } from '../error-text.ts';
import type { NodeLifecycle } from '../node-lifecycle.ts';
import type { Timers } from '../timers.ts';
import type { SessionEvent, SessionSink } from '../wire.ts';
import type { SecretFiles } from './secret-files.ts';
import {
    SecretRequests,
    type SecretAnswer,
    type SecretAsk,
    type SecretChats,
    type SecretFile,
    type SecretTarget,
    type SecretValues
} from './secret-requests.ts';
import type { SecretSlot, SecretStore } from './secret-store.ts';

/* What a Save changes on the launch: the variable becomes a reference to the stored secret. */
interface SecretLaunches {
    bindSecret(projectId: string, launchId: string, variable: string): Promise<void>;
}

/*
 * The secrets agents ask for, as the daemon wires them: the cards every client hears, a person's answer,
 * and what ends a card besides an answer. A launch's Save writes the value first and binds it second,
 * and a value that was not there before goes again when the binding fails, so a failed Save leaves
 * nothing. A file card's Save writes one file per value.
 */
export class SecretService {
    private readonly store: Pick<SecretStore, 'has' | 'write' | 'remove'>;
    private readonly files: Pick<SecretFiles, 'write'>;
    private readonly launches: SecretLaunches;
    private readonly sinks = new ClientSinks();
    private readonly requests: SecretRequests;

    constructor(options: {
        store: Pick<SecretStore, 'has' | 'write' | 'remove'>;
        files: Pick<SecretFiles, 'write'>;
        launches: SecretLaunches;
        chats: SecretChats;
        now?: () => number;
        timers?: Timers;
        cardMs?: number;
    }) {
        this.store = options.store;
        this.files = options.files;
        this.launches = options.launches;
        this.requests = new SecretRequests({
            sink: {
                has: (projectId, target) => (target.delivery === 'launch' ? this.store.has(projectId, target) : Promise.resolve(false)),
                save: (projectId, target, values) => this.keep(projectId, target, values)
            },
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

    ask(ask: SecretAsk, waitMs?: number): Promise<SecretAnswer> {
        return this.requests.ask(ask, waitMs);
    }

    list(): SecretRequest[] {
        return this.requests.list();
    }

    save(requestId: string, answer: SecretValues): Promise<boolean> {
        return this.requests.save(requestId, answer);
    }

    decline(requestId: string): boolean {
        return this.requests.decline(requestId);
    }

    observe(event: SessionEvent): void {
        if (event.event !== 'chat.event') {
            return;
        }

        const { chatId, event: chat } = event.payload;

        if ((chat.type === 'info' || chat.type === 'reset') && chat.info.status === 'exited') {
            this.requests.forget(chatId);
        }
    }

    follow(lifecycle: NodeLifecycle): void {
        lifecycle.on('closed', (nodeId) => this.nodeClosed(nodeId));
    }

    nodeClosed(nodeId: string): void {
        this.requests.forget(nodeId);
    }

    private async keep(projectId: string, target: SecretTarget, values: readonly { field: string | null; value: string }[]): Promise<SecretFile[]> {
        if (target.delivery === 'file') {
            const written: SecretFile[] = [];

            for (const { field, value } of values) {
                written.push({ field, path: await this.files.write(value) });
            }

            return written;
        }

        const [first] = values;

        if (first === undefined) {
            throw new Error('A launch card keeps one value');
        }

        await this.bind(projectId, target, first.value);

        return [];
    }

    private async bind(projectId: string, slot: SecretSlot, value: string): Promise<void> {
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
