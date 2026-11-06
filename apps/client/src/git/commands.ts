import { defineBehaviors } from '@/commands/behavior';
import { useUi } from '@/state/ui';

export const GIT_BEHAVIORS = defineBehaviors({
    'panel-git': { run: () => useUi.getState().togglePanel('git'), offered: (moment) => moment.inWorkspace && !moment.scratch }
});
