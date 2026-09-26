import type { CodexClientInfo } from '@ruimte/agents/chat/codex-transport';
import { createCodexProvider } from '@ruimte/agents/providers/codex-provider';

// How the daemon names itself to every app-server it opens.
export const RUIMTE_CODEX_CLIENT: CodexClientInfo = { name: 'ruimte', title: 'Ruimte', version: '0.1.0' };

export const codexProvider = createCodexProvider({ client: RUIMTE_CODEX_CLIENT });
