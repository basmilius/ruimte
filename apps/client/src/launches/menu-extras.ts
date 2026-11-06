import { only, submenu, t } from '@/commands/menu-builders';
import type { MenuExtra } from '@/commands/menu-extras';

/* The Run menu's row per launch, which puts that launch on the chip. */
export const LAUNCH_CHOOSE_PREFIX = 'launch-choose-';

/* The Run menu's row per task that may run after a worktree chat settles. */
export const AFTER_SETTLE_PREFIX = 'launch-after-settle-';

export const LAUNCH_MENU_EXTRAS: readonly MenuExtra[] = [
    {
        menu: 'run',
        group: 'choose',
        order: 10,
        build: (context, command) =>
            context.launches.map((launch) =>
                command(`${LAUNCH_CHOOSE_PREFIX}${launch.id}`, launch.name, { checked: launch.id === context.chosenLaunch, radio: true })
            )
    },
    {
        menu: 'run',
        group: 'setup',
        order: 10,
        build: (context, _command, itemsOf) =>
            only(context.afterSettle.tasks.length > 0, submenu('launches-after-settle', t('launchesAfterSettle'), itemsOf('launches-after-settle')))
    },
    {
        menu: 'launches-after-settle',
        group: 'tasks',
        order: 10,
        build: (context, command) =>
            context.afterSettle.tasks.map((task) =>
                command(`${AFTER_SETTLE_PREFIX}${task.id}`, task.name, { checked: task.id === context.afterSettle.chosen, radio: true })
            )
    }
];
