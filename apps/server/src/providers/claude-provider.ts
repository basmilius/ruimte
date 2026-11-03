import { createClaudeProvider, type ChatProvider } from '@adecore/agents/providers';
import { CLAUDE_ALLOW_MCP, withRuimteMcp } from './ruimte-mcp.ts';

// A terminal's line; a chat lets the tools through as the server it loads (`withRuimteMcp`).
export const CLAUDE_ALLOW_CONTEXT = `--allowedTools=${CLAUDE_ALLOW_MCP}`;

const base = createClaudeProvider();

export const claudeProvider: ChatProvider = {
    ...base,
    createBackend: (launch, host) => base.createBackend(withRuimteMcp(launch, 'variable'), host)
};
