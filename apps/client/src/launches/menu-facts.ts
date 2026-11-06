import type { MenuFacts, MenuHost } from '@/commands/menu-context';
import { afterSettleCandidates, chosenLaunchId } from '@/launches/actions';
import { launchViews } from '@/launches/model';
import { useLaunches } from '@/launches/state';
import { currentEndpointId } from '@/state/current-endpoint';
import { endpointKey } from '@/state/keys';
import { useProject } from '@/state/project';

export interface MenuLaunch {
    id: string;
    name: string;
    /* A process of it runs, or is being stopped; a group through its members. */
    live: boolean;
}

declare module '@/commands/menu-context' {
    interface MenuFacts {
        /* The launches of the project on screen, each with whether it runs. */
        launches: MenuLaunch[];
        /* The launch on the chip, which the Run menu's first rows act on. */
        chosenLaunch: string | null;
        /* The tasks that may run after a worktree chat settles, and the one that does, or null for none. */
        afterSettle: { tasks: { id: string; name: string }[]; chosen: string | null };
    }
}

export function launchFacts(_host: MenuHost): Pick<MenuFacts, 'launches' | 'chosenLaunch' | 'afterSettle'> {
    const projectId = useProject.getState().current?.projectId;
    const key = projectId === undefined ? null : endpointKey(currentEndpointId(), projectId);
    const { documents, statuses } = useLaunches.getState();
    const document = key === null ? undefined : documents[key];
    if (key === null || document === undefined) {
        return { launches: [], chosenLaunch: chosenLaunchId(), afterSettle: { tasks: [], chosen: null } };
    }
    const views = launchViews(document, statuses[key] ?? {});

    return {
        launches: document.launches.map((launch) => ({ id: launch.id, name: launch.name, live: views.get(launch.id)?.live === true })),
        chosenLaunch: chosenLaunchId(),
        afterSettle: {
            tasks: afterSettleCandidates(document).map((launch) => ({ id: launch.id, name: launch.name })),
            chosen: document.afterSettle?.launchId ?? null
        }
    };
}
