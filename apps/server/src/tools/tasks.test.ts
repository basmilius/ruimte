import { expect, test } from 'bun:test';
import type { ProjectContent } from '@ruimte/contracts';
import { callerKind } from './tasks.ts';

test('the caller in a design is its chat, so a verb that needs a chat takes it', () => {
    const content = {
        views: [
            {
                kind: 'design',
                id: 'onboarding',
                name: 'Onboarding',
                node: {},
                path: 'designs/onboarding',
                chats: [{ id: 'onboarding-2', name: 'Dark', node: {} }]
            },
            { kind: 'terminal', id: 'shell', name: 'Shell', node: {} }
        ]
    } as Pick<ProjectContent, 'views'> as ProjectContent;

    expect(callerKind(content, 'onboarding')).toBe('chat');
    expect(callerKind(content, 'onboarding-2')).toBe('chat');
    expect(callerKind(content, 'shell')).toBe('terminal');
    expect(callerKind(content, 'nobody')).toBeNull();
});
