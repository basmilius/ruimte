import type { AgentKind, ProviderCapabilities } from '@ruimte/contracts';
import { ModelCatalog } from './catalog.ts';
import { detectCli } from './detect.ts';
import type { ChatProvider } from './provider.ts';

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
    planMode: 'none',
    reportsCost: false,
    reportsContextWindow: false,
    slashCommands: false
};

// No models over the wire: the catalog is a chat concern and these CLIs pick their own model.
const EMPTY_CATALOG = { defaultModel: '', profiles: {}, models: [] };

const terminalProvider = (kind: AgentKind, name: string, command: string, resumeCommand: string): ChatProvider => ({
    kind,
    name,
    catalog: new ModelCatalog(EMPTY_CATALOG),
    capabilities: TERMINAL_ONLY_CAPABILITIES,
    command: [command],
    resumeCommand,
    detect: detectCli,
    createBackend: () => {
        throw new Error(`${name} has no chat backend; it runs as a terminal agent.`);
    }
});

export const geminiProvider = terminalProvider('gemini', 'Gemini', 'gemini', 'gemini --resume {id}');

export const copilotProvider = terminalProvider('copilot', 'GitHub Copilot', 'copilot', 'copilot --resume={id}');
