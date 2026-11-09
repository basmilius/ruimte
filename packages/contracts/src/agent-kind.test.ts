import { describe, expect, test } from 'bun:test';
import { AgentKindSchema, EndpointChangedEventSchema, REQUEST_SCHEMAS } from './index.ts';

describe('an agent kind on the wire', () => {
    test('a kind this version does not know by name still parses, so a newer machine reads', () => {
        const base = { id: 'm1', label: 'Mac', nameSource: 'default', icon: null };
        const summary = { providers: [{ provider: 'future-cli', state: 'on', reviewed: true }], fixed: false };

        expect(EndpointChangedEventSchema.parse({ ...base, textModel: { provider: 'future-cli', model: null } }).textModel?.provider).toBe('future-cli');
        expect(EndpointChangedEventSchema.parse({ ...base, agentIntegrations: summary }).agentIntegrations?.providers[0]?.provider).toBe('future-cli');
        expect(REQUEST_SCHEMAS['endpoint.setAgentIntegration'].payload.safeParse({ provider: 'grok', on: true }).success).toBe(true);
    });

    test('a kind stays an identifier, since it ends up in ids, paths and command lines', () => {
        for (const kind of ['Grok', '-grok', 'grok cli', '../grok', '', 'x'.repeat(33)]) {
            expect(AgentKindSchema.safeParse(kind).success).toBe(false);
        }
    });
});
