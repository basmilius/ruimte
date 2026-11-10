import type { MenuFacts, MenuHost } from '@/commands/menu-context';
import { currentEndpointId } from '@/state/current-endpoint';
import { pool } from '@/transport';
import { machineAnswers } from '@/transport/features';
import { windowWorkspace } from '@/workspace/window';

declare module '@/commands/menu-context' {
    interface MenuFacts {
        /* The project's machine answers routines (`routine.list`). */
        routines: boolean;
    }
}

export function routineFacts(_host: MenuHost): Pick<MenuFacts, 'routines'> {
    return { routines: windowWorkspace() !== null && machineAnswers(pool.statusOf(currentEndpointId()), 'routine.list') };
}
