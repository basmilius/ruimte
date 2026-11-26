import { watchHostSkills } from '@/chat/host-skills';
import { ensureDatabaseConnections } from '@/database/connections';
import { startLaunchWatch } from '@/launches/watch';
import { workspaceEffects } from '@/registry/workspace-effects';
import { machineAnswers } from '@/transport/features';
import { pool } from '@/transport/index';
import { startViewWindows } from '@/view-windows/start';
import { stopVoice } from '@/voice/controller';
import { watchEveryMachine } from '@/workspace/connections';

export function installWorkspaceEffects(): void {
    workspaceEffects.add(
        // The project's agents open its databases with the passwords this window holds, so they are read with the project rather than with the panel.
        { id: 'database-connections', mounted: () => ensureDatabaseConnections() },
        { id: 'voice', mounted: () => stopVoice },
        { id: 'launch-watch', mounted: () => startLaunchWatch() },
        { id: 'view-windows', mounted: () => startViewWindows() },
        // Only a chat in a workspace offers Ruimte's skills, so the start screen's chunk does without them.
        {
            id: 'host-skills',
            mounted: () =>
                watchEveryMachine((endpointId, transport) =>
                    watchHostSkills(endpointId, transport, () => machineAnswers(pool.statusOf(endpointId), 'skill.list'))
                )
        }
    );
}
