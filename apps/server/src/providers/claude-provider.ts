import { createClaudeProvider, type ChatProvider } from '@adecore/agents/providers';
import { withRuimteMcp } from '../ruimte-mcp.ts';

const base = createClaudeProvider();

export const claudeProvider: ChatProvider = {
    ...base,
    createBackend: (launch, host) => base.createBackend(withRuimteMcp(launch, 'variable'), host)
};
