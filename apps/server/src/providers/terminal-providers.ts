import type { AgentKind, ProviderCapabilities } from '@ruimte/contracts';
import { ModelCatalog } from '@ruimte/agents/providers/catalog';
import { detectCli } from '@ruimte/agents/providers/detect';
import type { ChatProvider } from '@ruimte/agents/providers/provider';

// A CLI Ruimte only starts in a shell: no chat backend, no hooks, so no status beyond the session's own.
const TERMINAL_ONLY_CAPABILITIES: ProviderCapabilities = {
    chat: false,
    terminal: true,
    hooks: false,
    streamsToolOutput: false,
    diffs: 'none',
    attachments: false,
    mentions: false,
    denyReason: false,
    allowAlways: false,
    asyncQuestions: false,
    compaction: 'none',
    reportsCost: false,
    reportsContextWindow: false,
    reportsThinking: false,
    slashCommands: false
};

// No models over the wire: the catalog is a chat concern and these CLIs pick their own model.
const EMPTY_CATALOG = { defaultModel: '', profiles: {}, models: [] };

const terminalProvider = (
    kind: AgentKind,
    name: string,
    command: string,
    resumeCommand: string,
    firstPromptArgs: (prompt: string) => string[]
): ChatProvider => ({
    kind,
    name,
    catalog: new ModelCatalog(EMPTY_CATALOG),
    capabilities: TERMINAL_ONLY_CAPABILITIES,
    command: [command],
    resumeCommand,
    detect: detectCli,
    firstPromptArgs,
    createBackend: () => {
        throw new Error(`${name} has no chat backend; it runs as a terminal agent.`);
    }
});

export const geminiProvider: ChatProvider = {
    // `--prompt` answers and exits; `-i` (`--prompt-interactive`) runs the prompt and stays.
    ...terminalProvider('gemini', 'Gemini', 'gemini', 'gemini {flags} --resume {id}', (prompt) => ['-i', prompt]),
    oneShotArgs: (prompt) => ['--prompt', prompt]
};

export const copilotProvider = terminalProvider('copilot', 'GitHub Copilot', 'copilot', 'copilot {flags} --resume={id}', (prompt) => ['-p', prompt]);
