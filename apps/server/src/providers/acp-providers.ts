import type { AcpClientInfo } from '@adecore/agents/chat';
import {
    createAntigravityProvider as createSharedAntigravityProvider,
    createCopilotProvider as createSharedCopilotProvider,
    createGrokProvider as createSharedGrokProvider,
    type AcpCatalogStore,
    type AcpVendorOptions,
    type ChatProvider
} from '@adecore/agents/providers';
import { withRuimteMcp } from '../ruimte-mcp.ts';

// How the daemon names itself to every ACP agent it starts.
export const RUIMTE_ACP_CLIENT: AcpClientInfo = { name: 'ruimte', title: 'Ruimte', version: '0.1.0' };

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

/* An Antigravity chat logs every turn's usage too, since agy keeps no file the usage page can read. */
export function createAntigravityProvider(catalogStore?: AcpCatalogStore, usageLog?: string): ChatProvider {
    return createSharedAntigravityProvider({ ...ruimteChats(catalogStore), ...(usageLog === undefined ? {} : { usageLog }) });
}
