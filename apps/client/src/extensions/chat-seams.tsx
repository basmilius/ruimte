import { createElement, type ReactNode } from 'react';
import { useMachineComposer } from '@/extensions/machine-composer';
import { SlotRow } from '@/extensions/SlotSurfaces';
import { useContributions } from '@/state/extension-registry';

/* The commands of extensions after `/`: those of `client/`, then what `server/` adds under a name no client command has. */
export function useExpandingCommands() {
    const machine = useMachineComposer();
    const fromClient = useContributions((state) => state.slashCommands).map((command) => ({
        name: command.name,
        hint: command.description,
        expand: command.expand
    }));
    const taken = new Set(fromClient.map((command) => command.name));
    const fromMachine = machine.commands
        // Also one name between two extensions: the composer runs a command by its name, so the first keeps it.
        .filter((command) => !taken.has(command.name) && taken.add(command.name) !== undefined)
        .map((command) => ({ name: command.name, hint: command.description, expand: (args: string) => machine.expand(command, args) }));

    return [...fromClient, ...fromMachine];
}

/* A tool call an extension draws. Every other stays the thread's own. */
export function renderToolResult(tool: { name: string; input: unknown; output: string | null; state: string }): ReactNode {
    const result = useContributions.getState().toolResults.find((each) => each.tools.includes(tool.name));

    return result === undefined
        ? null
        : createElement(result.component, { call: { name: tool.name, input: tool.input, output: tool.output, state: tool.state } });
}

export function renderEmptyThread(chatId: string): ReactNode {
    return <SlotRow place="emptyThread" context={{ chat: { id: chatId } }} words />;
}

export function renderToolActions(tool: { name: string; input: unknown; output: string | null; state: string }, chatId: string | undefined): ReactNode {
    return (
        <SlotRow
            place="toolActions"
            context={{ chat: { id: chatId ?? '' }, tool: { name: tool.name, input: tool.input, output: tool.output, state: tool.state } }}
            wrap={(row) => <div className="flex items-center justify-end gap-1">{row}</div>}
        />
    );
}

export function renderMessageActions({ chatId, id, kind, text }: { chatId: string; id: string; kind: 'user' | 'assistant'; text: string }): ReactNode {
    return <SlotRow place="messageActions" context={{ chat: { id: chatId }, message: { id, kind, text } }} />;
}
