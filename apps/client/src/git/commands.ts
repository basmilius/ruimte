import { defineBehaviors } from '@/commands/behavior';
import { showBranchCompare } from '@/files/branch-compare';
import { useUi } from '@/state/ui';

export const GIT_BEHAVIORS = defineBehaviors({
    'panel-git': { run: () => useUi.getState().togglePanel('git'), offered: (moment) => moment.inWorkspace && !moment.scratch },
    'git-compare-branches': { run: () => showBranchCompare(), offered: (moment) => moment.inWorkspace && !moment.scratch, afterClose: true }
});
