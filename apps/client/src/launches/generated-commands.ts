import { ListChecks, Rocket } from 'lucide-react';
import type { GeneratedCommands } from '@/commands/generated';
import { chooseAfterSettle, chooseLaunch } from '@/launches/actions';
import { AFTER_SETTLE_PREFIX, LAUNCH_CHOOSE_PREFIX } from '@/launches/menu-extras';

/* The rows made once per launch, apart from the palette's, so the start screen's chunk holds no command of a workspace. */
export const LAUNCH_GENERATED: readonly GeneratedCommands[] = [
    { prefix: 'launch-start-', usage: 'launchStart', palette: true },
    { prefix: 'launch-restart-', usage: 'launchRestart', palette: true },
    { prefix: 'launch-stop-', usage: 'launchStopListed', palette: true },
    { prefix: LAUNCH_CHOOSE_PREFIX, usage: 'launchChoose', palette: false, icon: Rocket, run: chooseLaunch },
    { prefix: AFTER_SETTLE_PREFIX, usage: 'launchAfterSettle', palette: true, icon: ListChecks, run: (taskId) => void chooseAfterSettle(taskId) }
];
