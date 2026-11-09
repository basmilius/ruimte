import type { GeneratedCommands } from '@/commands/generated';

/* The rows made once per agent CLI, apart from what they do, so the start screen's chunk holds no command of a workspace. */
export const AGENT_GENERATED: readonly GeneratedCommands[] = [
    { prefix: 'agent-view-chat-', usage: 'agentViewChat', palette: true },
    { prefix: 'agent-view-terminal-', usage: 'agentViewTerminal', palette: true },
    { prefix: 'agent-chat-', usage: 'agentChat', palette: true },
    { prefix: 'agent-terminal-', usage: 'agentTerminal', palette: true }
];
