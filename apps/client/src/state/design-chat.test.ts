import { afterEach, describe, expect, test } from 'bun:test';
import type { ProjectDesignView } from '@ruimte/contracts';
import { ARTIFACT_KEY_PATTERN } from '@ruimte/contracts';
import { activeDesignChat, designVersionKey, placeOfView, useDesignChat } from './design-chat';

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
    expect(activeDesignChat(placeOfView(design), {})).toBe('onboarding-3');
    expect(activeDesignChat(placeOfView(design), { onboarding: 'onboarding' })).toBe('onboarding');
    expect(activeDesignChat(placeOfView(design), { onboarding: 'removed' })).toBe('onboarding-3');
    expect(activeDesignChat(placeOfView({ ...design, chats: undefined }), {})).toBe('onboarding');
});

describe('a page the chat makes', () => {
    const before = useDesignChat.getState();

    afterEach(() => {
        useDesignChat.setState(before, true);
    });

    test('comes in front of a Design view, also over a page a person picked', () => {
        useDesignChat.getState().pickPage('pricing', '1a Calm.html');
        useDesignChat.getState().followNewPage('pricing', '3a Airy.html', 'every');

        expect(useDesignChat.getState().pages.pricing).toBe('3a Airy.html');
    });

    test("comes in front of a design agent's design until a person picks a page, and then leaves theirs in front", () => {
        useDesignChat.getState().openAgentPage('designer', 'Checkout.html', false);
        useDesignChat.getState().followNewPage('designer', 'Pricing.html', 'until-picked');

        expect(useDesignChat.getState().pages.designer).toBe('Pricing.html');

        useDesignChat.getState().pickPage('designer', 'Checkout.html');
        useDesignChat.getState().followNewPage('designer', '_tmp-check.html', 'until-picked');

        expect(useDesignChat.getState().pages.designer).toBe('Checkout.html');
    });

    test('stays behind a page a person picked on the card, and follows again once the design opens without one', () => {
        useDesignChat.getState().openAgentPage('designer', 'Checkout.html', true);
        useDesignChat.getState().followNewPage('designer', 'Pricing.html', 'until-picked');

        expect(useDesignChat.getState().pages.designer).toBe('Checkout.html');

        useDesignChat.getState().openAgentPage('designer', 'Checkout.html', false);
        useDesignChat.getState().followNewPage('designer', 'Pricing.html', 'until-picked');

        expect(useDesignChat.getState().pages.designer).toBe('Pricing.html');
    });
});

test('every saved version of a design joins one artifact, under a key Output takes', () => {
    expect(designVersionKey('design-Ab_3')).toBe('design-design-ab-3');
    expect(designVersionKey('x'.repeat(80))).toHaveLength(64);
    expect(ARTIFACT_KEY_PATTERN.test(designVersionKey('View 42'))).toBe(true);
});
