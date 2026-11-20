import type { ComponentType } from 'react';

type AgentDesignComponent = ComponentType<{ chatId: string; focused: boolean }>;

export let AgentDesignBody: AgentDesignComponent | null = null;

/* Handed over from `design`, which imports the chat body that draws it; the chat body cannot import `design` back. */
export function provideAgentDesignBody(body: AgentDesignComponent): void {
    AgentDesignBody = body;
}
