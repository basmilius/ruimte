import { CodexBackend } from '../chat/codex-backend.ts';
import { ModelCatalog } from './catalog.ts';
import { CODEX_CAPABILITIES, CODEX_CHAT_ARGS, CODEX_RESUME_COMMAND } from './codex.ts';
import codexManifest from './codex-models.json' with { type: 'json' };
import { detectCli } from './detect.ts';
import type { ChatProvider } from './provider.ts';

export const codexProvider: ChatProvider = {
    kind: 'codex',
    name: 'Codex',
    catalog: new ModelCatalog(codexManifest as never),
    capabilities: CODEX_CAPABILITIES,
    command: ['codex', ...CODEX_CHAT_ARGS],
    resumeCommand: CODEX_RESUME_COMMAND,
    // The auth variables Codex 0.157 names in its own "no Codex credentials were found" advice.
    home: { env: 'CODEX_HOME', fallback: '.codex', loginEnv: ['OPENAI_API_KEY', 'CODEX_API_KEY', 'CODEX_ACCESS_TOKEN'] },
    detect: detectCli,
    // Read-only and without an approval to wait for: the run only has to read what it is handed. A chat's
    // title is asked in a folder that need not be a repository, and ephemeral keeps the run out of Codex's thread list.
    oneShotArgs: (prompt) => ['exec', '--color', 'never', '--sandbox', 'read-only', '--skip-git-repo-check', '--ephemeral', prompt],
    // `codex [OPTIONS] [PROMPT]`: the positional starts the interactive session on that prompt.
    firstPromptArgs: (prompt) => [prompt],
    createBackend: (launch, host) => new CodexBackend(launch, host)
};
