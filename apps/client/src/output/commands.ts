import { defineBehaviors } from '@/commands/behavior';
import { useUi } from '@/state/ui';

export const OUTPUT_BEHAVIORS = defineBehaviors({
    'panel-output': { run: () => useUi.getState().togglePanel('output'), offered: (moment) => moment.inWorkspace }
});
