import { createElement, type ReactNode } from 'react';
import { useContributions } from '@/extensions/registry';

/* A fenced block an extension draws. Every other language stays the chat's own code block. */
export function renderCodeFence(language: string | undefined, code: string): ReactNode | null {
    const block = useContributions.getState().markdownBlocks.find((each) => each.language === language);

    return block === undefined ? null : createElement(block.component, { source: code });
}
