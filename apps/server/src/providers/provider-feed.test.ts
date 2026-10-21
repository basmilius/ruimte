import { describe, expect, test } from 'bun:test';
import type { AgentKind, ProviderInfo } from '@ruimte/contracts';
import type { SessionEvent } from '../sessions/manager.ts';
import { ProviderFeed } from './provider-feed.ts';

function changingProviders() {
    let listener: (kind: AgentKind) => void = () => undefined;
    let lists = 0;
    return {
        onChange(next: (kind: AgentKind) => void): () => void {
            listener = next;
            return () => undefined;
        },
        current(): Promise<ProviderInfo[]> {
            lists += 1;
            return Promise.resolve([{ kind: 'grok', name: `Grok ${lists}` } as ProviderInfo]);
        },
        change(kind: AgentKind): void {
            listener(kind);
        },
        get lists(): number {
            return lists;
        }
    };
}

describe('ProviderFeed', () => {
    test('sends every client the list as it stands once a provider changed', async () => {
        const providers = changingProviders();
        const feed = new ProviderFeed(providers);
        const heard: SessionEvent[] = [];
        feed.subscribe('a', (event) => heard.push(event));
        providers.change('grok');
        await feed.settled();
        expect(heard).toEqual([{ event: 'provider.changed', payload: { providers: [{ kind: 'grok', name: 'Grok 1' } as ProviderInfo] } }]);
    });

    test('changes that come while a list is on its way go out as one more', async () => {
        const providers = changingProviders();
        const feed = new ProviderFeed(providers);
        const heard: SessionEvent[] = [];
        feed.subscribe('a', (event) => heard.push(event));
        providers.change('grok');
        providers.change('copilot');
        providers.change('grok');
        await feed.settled();
        expect(providers.lists).toBe(2);
        expect(heard).toHaveLength(2);
    });
});
