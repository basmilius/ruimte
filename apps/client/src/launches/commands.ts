import { isInFloatingLayer } from '@adecore/ui';
import i18next from 'i18next';
import { ListChecks, Rocket } from 'lucide-react';
import { defineBehaviors, takeKey, type Command } from '@/commands/behavior';
import type { GeneratedCommands } from '@/commands/generated';
import type { CommandMoment } from '@/commands/moment';
import {
    afterSettleCandidates,
    chooseAfterSettle,
    chooseLaunch,
    chosenLaunchId,
    runChosenLaunch,
    showLaunchOutput,
    startLaunch,
    stopAllLaunches,
    stopChosenLaunch,
    stopLaunch
} from '@/launches/actions';
import { AFTER_SETTLE_PREFIX, LAUNCH_CHOOSE_PREFIX } from '@/launches/menu-extras';
import { launchViews } from '@/launches/model';
import { useLaunches } from '@/launches/state';
import { endpointKey } from '@/state/keys';
import { isScratchProject, useProject } from '@/state/project';

function launchesOfProject(): { key: string; document: NonNullable<ReturnType<typeof useLaunches.getState>['documents'][string]> } | null {
    const { current, currentEndpointId } = useProject.getState();
    if (current === null || currentEndpointId === null) {
        return null;
    }
    const key = endpointKey(currentEndpointId, current.projectId);
    const document = useLaunches.getState().documents[key];

    return document === undefined ? null : { key, document };
}

function hasLaunches(moment: CommandMoment): boolean {
    return moment.inWorkspace && !moment.scratch && launchesOfProject() !== null;
}

/* From anywhere but a popup, a terminal included: restarting the server is what you do while typing. */
function launchKey(run: () => void): (press: Parameters<typeof takeKey>[0]) => boolean {
    return (press) => {
        // The Chats project has no launches, and its keys fall through to whatever has the focus.
        if (isScratchProject(useProject.getState().current)) {
            return true;
        }
        if (!isInFloatingLayer(press.event.target)) {
            takeKey(press, run);
        }

        return true;
    };
}

export const LAUNCH_BEHAVIORS = defineBehaviors({
    'launch-run': { run: runChosenLaunch, key: launchKey(runChosenLaunch) },
    'launch-stop': { run: stopChosenLaunch, key: launchKey(stopChosenLaunch) },
    'launches-stop-all': { run: stopAllLaunches },
    'launches-output': { run: () => showLaunchOutput() },
    'launches-edit': {
        run: () => useLaunches.getState().setDialog({ kind: 'edit', launchId: chosenLaunchId() }),
        offered: hasLaunches
    },
    'launches-after-settle-off': {
        run: () => void chooseAfterSettle(null),
        offered: (moment) => hasLaunches(moment) && launchesOfProject()?.document.afterSettle !== undefined
    }
});

/* One row per launch that says what a press does to it now, so a launch that runs offers its restart and its stop; and the tasks that may run after a worktree chat settles. */
export function launchPaletteRows(moment: CommandMoment): Command[] {
    const found = launchesOfProject();
    if (!moment.inWorkspace || moment.scratch || found === null) {
        return [];
    }
    const { key, document } = found;
    const views = launchViews(document, useLaunches.getState().statuses[key] ?? {});
    const chosen = document.afterSettle;

    return [
        ...document.launches.flatMap((launch): Command[] =>
            views.get(launch.id)?.live === true
                ? [
                      {
                          id: `launch-restart-${launch.id}`,
                          label: i18next.t('launches:palette.restart', { name: launch.name }),
                          run: () => void startLaunch(launch.id, { restart: true })
                      },
                      {
                          id: `launch-stop-${launch.id}`,
                          label: i18next.t('launches:palette.stop', { name: launch.name }),
                          run: () => void stopLaunch(launch.id)
                      }
                  ]
                : [
                      {
                          id: `launch-start-${launch.id}`,
                          label: i18next.t('launches:palette.start', { name: launch.name }),
                          run: () => void startLaunch(launch.id)
                      }
                  ]
        ),
        ...afterSettleCandidates(document).flatMap((launch): Command[] =>
            chosen?.launchId === launch.id && chosen.approved
                ? []
                : [
                      {
                          id: `launch-after-settle-${launch.id}`,
                          label: i18next.t(chosen?.launchId === launch.id ? 'launches:palette.afterSettleApprove' : 'launches:palette.afterSettle', {
                              name: launch.name
                          }),
                          run: () => void chooseAfterSettle(launch.id)
                      }
                  ]
        )
    ];
}

export const LAUNCH_GENERATED: readonly GeneratedCommands[] = [
    { prefix: 'launch-start-', usage: 'launchStart', palette: true },
    { prefix: 'launch-restart-', usage: 'launchRestart', palette: true },
    { prefix: 'launch-stop-', usage: 'launchStopListed', palette: true },
    { prefix: LAUNCH_CHOOSE_PREFIX, usage: 'launchChoose', palette: false, icon: Rocket, run: chooseLaunch },
    { prefix: AFTER_SETTLE_PREFIX, usage: 'launchAfterSettle', palette: true, icon: ListChecks, run: (taskId) => void chooseAfterSettle(taskId) }
];
