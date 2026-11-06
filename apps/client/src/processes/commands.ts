import { defineBehaviors } from '@/commands/behavior';
import { useUi } from '@/state/ui';

export const PROCESS_BEHAVIORS = defineBehaviors({
    'panel-processes': { run: () => useUi.getState().togglePanel('processes'), offered: (moment) => moment.inWorkspace }
});
