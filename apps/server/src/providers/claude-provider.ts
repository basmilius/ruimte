import { ClaudeBackend } from '../chat/claude-backend.ts';
import { ModelCatalog } from './catalog.ts';
import { CLAUDE_CAPABILITIES, CLAUDE_RESUME_COMMAND } from './claude.ts';
import { detectCli } from './detect.ts';
import type { ChatProvider } from './provider.ts';

export const claudeProvider: ChatProvider = {
    kind: 'claude',
    name: 'Claude Code',
    catalog: new ModelCatalog(),
    capabilities: CLAUDE_CAPABILITIES,
    command: ['claude'],
    resumeCommand: CLAUDE_RESUME_COMMAND,
    // Read from the strings of Claude Code 2.1.282; never HOME, which moves the keychain lookup along with it.
    home: { env: 'CLAUDE_CONFIG_DIR', fallback: '.claude', loginEnv: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN'] },
    detect: detectCli,
    oneShotArgs: (prompt) => ['-p', prompt, '--output-format', 'text'],
    // `claude [options] [prompt]`: the prompt is the positional, and without -p the session stays.
    firstPromptArgs: (prompt) => [prompt],
    createBackend: (launch, host) => new ClaudeBackend(launch, host)
};
