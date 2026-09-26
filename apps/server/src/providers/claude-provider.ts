import { createClaudeProvider } from '@ruimte/agents/providers/claude-provider';

/*
 * Every `ruimte-context` call goes through without a prompt, in every mode: the daemon already enforces each
 * verb (mode ceiling, depth, cwd), so a prompt adds no protection.
 */
export const RUIMTE_CONTEXT_TOOL = 'Bash(ruimte-context *)';

export const CLAUDE_ALLOW_CONTEXT = `--allowedTools=${RUIMTE_CONTEXT_TOOL}`;

export const claudeProvider = createClaudeProvider({ allowedTools: [RUIMTE_CONTEXT_TOOL] });
