import { createElement, type ReactNode } from 'react';
import { useContributions } from '@/extensions/registry';
import { SlotRow } from '@/extensions/SlotSurfaces';

export function useExpandingCommands() {
    return useContributions((state) => state.slashCommands).map((command) => ({ name: command.name, hint: command.description, expand: command.expand }));
}

/* A tool call an extension draws. Every other stays the thread's own. */
export function renderToolResult(tool: { name: string; input: unknown; output: string | null; state: string }): ReactNode {
    const result = useContributions.getState().toolResults.find((each) => each.tools.includes(tool.name));

    return result === undefined
        ? null
        : createElement(result.component, { call: { name: tool.name, input: tool.input, output: tool.output, state: tool.state } });
}

export function renderMessageActions({ chatId, id, kind, text }: { chatId: string; id: string; kind: 'user' | 'assistant'; text: string }): ReactNode {
    return <SlotRow place="messageActions" context={{ chat: { id: chatId }, message: { id, kind, text } }} />;
}
