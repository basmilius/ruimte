import type { AcpClientInfo } from '@adecore/agents/chat';
import {
    createAntigravityProvider as createSharedAntigravityProvider,
    createCopilotProvider as createSharedCopilotProvider,
    createGrokProvider as createSharedGrokProvider,
    type AcpCatalogStore,
    type AcpServerLaunch,
    type AcpVendorOptions,
    type ChatProvider
} from '@adecore/agents/providers';
import { withRuimteMcp } from '../ruimte-mcp.ts';
import { parseAcpServerRelease } from './acp-server.ts';
import antigravityRelease from './antigravity-acp-release.json' with { type: 'json' };

// How the daemon names itself to every ACP agent it starts.
export const RUIMTE_ACP_CLIENT: AcpClientInfo = { name: 'ruimte', title: 'Ruimte', version: '0.1.0' };

/* Google's ACP server for Antigravity, pinned to the release the ACP registry lists (`antigravity-acp`). */
export const ANTIGRAVITY_ACP_RELEASE = parseAcpServerRelease(antigravityRelease);

/* Every built-in ACP agent names Ruimte and loads Ruimte's MCP server in its chats. */
function ruimteChats(catalogStore: AcpCatalogStore | undefined): AcpVendorOptions {
    return { client: RUIMTE_ACP_CLIENT, launch: withRuimteMcp, ...(catalogStore === undefined ? {} : { catalogStore }) };
}

export function createGrokProvider(catalogStore?: AcpCatalogStore): ChatProvider {
    return createSharedGrokProvider(ruimteChats(catalogStore));
}

/* A chat's Copilot loads Ruimte's MCP server from its session request, and its backend allows the tools on its line. */
export function createCopilotProvider(catalogStore?: AcpCatalogStore, usageLog?: string): ChatProvider {
    return createSharedCopilotProvider({ ...ruimteChats(catalogStore), ...(usageLog === undefined ? {} : { usageLog }) });
}

/* Without an installed server a chat cannot start; the person installs one from the Providers pane. */
export function createAntigravityProvider(server: AcpServerLaunch | null, catalogStore?: AcpCatalogStore): ChatProvider {
    return createSharedAntigravityProvider({
        ...ruimteChats(catalogStore),
        server,
        installHint: 'Install the Antigravity server in Settings, Providers first.'
    });
}
