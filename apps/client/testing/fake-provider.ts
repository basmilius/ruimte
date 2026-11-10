import type { ProviderInfo } from '@ruimte/contracts';

/* An installed agent CLI with one model that chats and runs in a terminal, for a fake machine's `provider.list`. */
export function fakeProvider(kind: string, name: string, patch: Partial<ProviderInfo> = {}): ProviderInfo {
    return {
        kind,
        name,
        installed: true,
        version: '1.0.0',
        models: [{ slug: 'model', name: 'Model', legacy: false, isDefault: true, options: [] }],
        defaultModel: 'model',
        capabilities: { chat: true, terminal: true },
        resumeCommand: null,
        ...patch
    } as unknown as ProviderInfo;
}

/* Claude Code as the tests know it: installed, with the capabilities a test gives it, and a conversation that can be forked as the real one's can. */
export function claudeProvider(capabilities: Record<string, unknown> = { chat: true, terminal: true }): ProviderInfo {
    return fakeProvider('claude', 'Claude Code', {
        version: '2.1.0',
        capabilities: { fork: true, ...capabilities },
        resumeCommand: 'claude --resume {id}'
    } as Partial<ProviderInfo>);
}
