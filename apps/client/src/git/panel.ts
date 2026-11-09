import { lazyNamed } from '@adecore/ui';
import { GitBranch } from 'lucide-react';
import type { PanelDefinition } from '@/registry/panels';

export const GIT_PANEL: PanelDefinition = {
    id: 'git',
    icon: GitBranch,
    minWidth: 240,
    toolbar: true,
    group: 'project',
    component: lazyNamed(() => import('@/git/GitPanel'), 'GitPanel')
};
