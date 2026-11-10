import { describe, expect, test } from 'bun:test';
import { canForkWith } from '@adecore/agents-react/chat';
import { REQUEST_SCHEMAS, type ProviderInfo, type RequestType } from '@ruimte/contracts';
import { fakeProvider } from '../../testing/fake-provider';
import { providersOfMachine } from './machine-providers';

const EVERY_REQUEST = Object.keys(REQUEST_SCHEMAS) as RequestType[];
const OLDER = { features: EVERY_REQUEST.filter((type) => type !== 'project.watch') };
const CURRENT = { features: EVERY_REQUEST };

function forkable(connection: { features: readonly string[] }, providers: ProviderInfo[]): string[] {
    return providersOfMachine(connection, providers)
        .filter((provider) => canForkWith(provider))
        .map((provider) => provider.kind);
}

describe('the providers of a machine', () => {
    test('a machine from before the fork capability offers Fork for claude and codex, as it did, and for no other', () => {
        const providers = [fakeProvider('claude', 'Claude Code'), fakeProvider('codex', 'Codex'), fakeProvider('grok', 'Grok')];

        expect(forkable(OLDER, providers)).toEqual(['claude', 'codex']);
    });

    test('a machine that names fork itself is followed, also where it refuses', () => {
        const providers = [
            fakeProvider('claude', 'Claude Code', { capabilities: { chat: true, terminal: true, fork: true } } as Partial<ProviderInfo>),
            fakeProvider('codex', 'Codex'),
            fakeProvider('grok', 'Grok', { capabilities: { chat: true, terminal: true, fork: true } } as Partial<ProviderInfo>)
        ];

        expect(forkable(CURRENT, providers)).toEqual(['claude', 'grok']);
    });
});
