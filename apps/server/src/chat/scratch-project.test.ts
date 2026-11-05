import { describe, expect, test } from 'bun:test';
import type { ProjectChatView } from '@ruimte/contracts';
import { reusableChat } from './scratch-project.ts';

describe('the empty chat a new chat reuses', () => {
    const view = (id: string, node: ProjectChatView['node'], empty?: boolean): ProjectChatView => ({
        kind: 'chat',
        id,
        name: 'New chat',
        node,
        ...(empty ? { empty } : {})
    });

    test('is one nobody wrote in, of the CLI and account asked for when the request names them', () => {
        const views = [view('written', {}), view('codex', { provider: 'codex' }, true), view('claude', { provider: 'claude', account: 'work' }, true)];

        expect(reusableChat(views, {})?.id).toBe('codex');
        expect(reusableChat(views, { provider: 'claude' })?.id).toBe('claude');
        expect(reusableChat(views, { provider: 'claude', account: 'home' })).toBeNull();
        expect(reusableChat([view('written', {})], {})).toBeNull();
    });
});
