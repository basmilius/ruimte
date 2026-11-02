import { createClaudeProvider } from '@adecore/agents/providers';
import { CLAUDE_ALLOW_MCP } from './ruimte-mcp.ts';

export const CLAUDE_ALLOW_CONTEXT = `--allowedTools=${CLAUDE_ALLOW_MCP}`;

export const claudeProvider = createClaudeProvider({ allowedTools: [CLAUDE_ALLOW_MCP] });
