import { defineBehaviors } from '@/commands/behavior';
import { useUi } from '@/state/ui';

export const PROBLEMS_BEHAVIORS = defineBehaviors({
    'panel-problems': { run: () => useUi.getState().togglePanel('problems'), offered: (moment) => moment.inWorkspace && !moment.scratch }
});
