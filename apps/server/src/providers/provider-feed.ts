import type { AgentKind, ProviderInfo } from '@ruimte/contracts';
import { ClientSinks } from '../client-sinks.ts';
import { errorText } from '../error-text.ts';
import type { SessionSink } from '../sessions/manager.ts';

interface ChangingProviders {
    onChange(listener: (kind: AgentKind) => void): () => void;
    current(): Promise<ProviderInfo[]>;
}

/*
 * Sends every client the provider list again once an agent reported models or abilities the machine did not know, so a
 * picker shows them without waiting for the next `provider.list`. Changes that come while a list is on its way go out as one more.
 */
export class ProviderFeed {
    private readonly sinks = new ClientSinks();
    private readonly providers: ChangingProviders;
    private sending: Promise<void> | null = null;
    private again = false;

    constructor(providers: ChangingProviders) {
        this.providers = providers;
        providers.onChange(() => this.announce());
    }

    subscribe(clientId: string, sink: SessionSink): () => void {
        return this.sinks.subscribe(clientId, sink);
    }

    /* Resolves once every change so far went out; for a test. */
    settled(): Promise<void> {
        return this.sending ?? Promise.resolve();
    }

    private announce(): void {
        if (this.sending !== null) {
            this.again = true;
            return;
        }
        this.sending = (async () => {
            do {
                this.again = false;
                const providers = await this.providers.current();
                this.sinks.emit({ event: 'provider.changed', payload: { providers } });
            } while (this.again);
        })()
            .catch((e: unknown) => console.warn('Could not send the provider list:', errorText(e)))
            .finally(() => {
                this.sending = null;
            });
    }
}
