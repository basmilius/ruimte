import { CircleOff, CircleStop, Pencil, Play, Square, SquareTerminal } from 'lucide-react';
import type { MenuContext } from '@/commands/menu-context';
import { type CommandSpec } from '@/commands/types';

export const LAUNCH_COMMANDS = {
    'launch-run': {
        key: 'launch',
        icon: Play,
        binds: 'workspace',
        palette: false,
        menu: {
            menu: 'run',
            group: 'launch',
            order: 10,
            when: hasLaunches,
            enabled: (context) => chosenLaunchOf(context) !== null,
            words: (context) => {
                const chosen = chosenLaunchOf(context);
                return chosen === null ? { key: 'launch' } : { key: chosen.live ? 'launchRestart' : 'launchStart', values: { name: chosen.name } };
            }
        }
    },
    'launch-stop': {
        key: 'launchStopNone',
        icon: Square,
        binds: 'workspace',
        palette: false,
        menu: {
            menu: 'run',
            group: 'launch',
            order: 20,
            when: hasLaunches,
            enabled: (context) => chosenLaunchOf(context)?.live === true,
            words: (context) => {
                const chosen = chosenLaunchOf(context);
                return chosen === null ? { key: 'launchStopNone' } : { key: 'launchStop', values: { name: chosen.name } };
            }
        }
    },
    'launches-stop-all': {
        key: 'launchesStopAll',
        icon: CircleStop,
        palette: false,
        menu: { menu: 'run', group: 'launch', order: 30, when: hasLaunches, enabled: (context) => context.launches.some((launch) => launch.live) }
    },
    'launches-output': {
        key: 'launchesOutput',
        icon: SquareTerminal,
        palette: false,
        menu: { menu: 'run', group: 'setup', order: 20, when: hasLaunches, enabled: (context) => chosenLaunchOf(context) !== null }
    },
    'launches-edit': { key: 'launchesEdit', icon: Pencil, palette: true, menu: { menu: 'run', group: 'setup', order: 30 } },
    'launches-after-settle-off': {
        key: 'launchesAfterSettleOff',
        icon: CircleOff,
        palette: true,
        menu: { menu: 'launches-after-settle', group: 'off', order: 10, checked: (context) => context.afterSettle.chosen === null, radio: true }
    }
} satisfies Record<string, CommandSpec>;

function hasLaunches(context: MenuContext): boolean {
    return context.launches.length > 0;
}

function chosenLaunchOf(context: MenuContext): MenuContext['launches'][number] | null {
    return context.launches.find((launch) => launch.id === context.chosenLaunch) ?? null;
}
