import { expect, test } from 'bun:test';
import type { ProjectDesignView } from '@ruimte/contracts';
import { ARTIFACT_KEY_PATTERN } from '@ruimte/contracts';
import { activeDesignChat, designVersionKey } from './design-chat';

const design: ProjectDesignView = {
    kind: 'design',
    id: 'onboarding',
    name: 'Onboarding',
    node: {},
    path: 'designs/onboarding',
    chats: [
        { id: 'onboarding-2', name: 'Dark mode', node: {} },
        { id: 'onboarding-3', name: 'Copy', node: {} }
    ]
};

test('a design shows the newest chat until a person picks another, and the newest again once that one is gone', () => {
    expect(activeDesignChat(design, {})).toBe('onboarding-3');
    expect(activeDesignChat(design, { onboarding: 'onboarding' })).toBe('onboarding');
    expect(activeDesignChat(design, { onboarding: 'removed' })).toBe('onboarding-3');
    expect(activeDesignChat({ ...design, chats: undefined }, {})).toBe('onboarding');
});

test('every saved version of a design joins one artifact, under a key Output takes', () => {
    expect(designVersionKey('design-Ab_3')).toBe('design-design-ab-3');
    expect(designVersionKey('x'.repeat(80))).toHaveLength(64);
    expect(ARTIFACT_KEY_PATTERN.test(designVersionKey('View 42'))).toBe(true);
});
