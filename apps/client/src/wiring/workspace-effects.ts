import { ensureDatabaseConnections } from '@/database/connections';
import { refreshPrRepos } from '@/github/pr-repos';
import { startLaunchWatch } from '@/launches/watch';
import { workspaceEffects } from '@/registry/workspace-effects';
import { stopVoice } from '@/voice/controller';

/* What features do while a workspace is on screen. */
export function installWorkspaceEffects(): void {
    workspaceEffects.add(
        // The project's agents open its databases with the passwords this window holds, so they are read with the project rather than with the panel.
        { id: 'database-connections', mounted: () => ensureDatabaseConnections() },
        { id: 'pull-request-repos', folderChanged: () => void refreshPrRepos() },
        { id: 'voice', mounted: () => stopVoice },
        { id: 'launch-watch', mounted: () => startLaunchWatch() }
    );
}
