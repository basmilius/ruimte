import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseHTML } from 'linkedom';
import type { ChatApprovalItem } from '@ruimte/agent-contracts';
import { ApprovalActions } from '../ui/PromptActions';
import { focusPromptHeading, focusPromptStart } from './focus';
import { PROMPT_SAMPLES } from './prompts.fixtures';
import { approvalButtons } from './subjects';

const command = PROMPT_SAMPLES.find((sample) => sample.label === 'Permission · Command')!.items[0] as ChatApprovalItem;

/* A card with the approval toolbar the chat draws, and which element took the keyboard. */
const approvalCard = () => {
    const buttons = approvalButtons({ kind: 'chat', nodeId: 'chat-1', item: command }, '').map(({ action: _action, ...button }) => ({
        ...button,
        onPress: () => {}
    }));
    const toolbar = renderToStaticMarkup(createElement(ApprovalActions, { buttons, locked: false, sending: false }));
    const { document } = parseHTML(
        `<html><body><div class="prompt-card"><h3 tabindex="-1" class="prompt-heading">Run command</h3><div role="toolbar">${toolbar}</div></div></body></html>`
    );
    const focused: string[] = [];
    for (const element of document.querySelectorAll<HTMLElement>('.prompt-heading, button')) {
        element.focus = () => void focused.push(element.textContent ?? '');
    }
    return { root: document.body, focused };
};

describe('where a card takes the keyboard', () => {
    test('an approval starts on Deny, never on a button that grants for good', () => {
        const { root, focused } = approvalCard();
        expect(focusPromptStart(root)).toBe(true);
        expect(focused).toEqual(['Deny']);
    });

    test('typing that runs on into a card lands on its heading, where a key answers nothing', () => {
        const { root, focused } = approvalCard();
        expect(focusPromptHeading(root)).toBe(true);
        expect(focused).toEqual(['Run command']);
    });

    test('a root without a card takes nothing', () => {
        const { document } = parseHTML('<html><body><div></div></body></html>');
        expect(focusPromptStart(document.body)).toBe(false);
        expect(focusPromptHeading(document.body)).toBe(false);
    });
});
