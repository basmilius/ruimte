import { lazyNamed } from '@adecore/ui';
import { CircleAlert } from 'lucide-react';
import type { PanelDefinition } from '@/registry/panels';

export const PROBLEMS_PANEL: PanelDefinition = {
    id: 'problems',
    icon: CircleAlert,
    minWidth: 360,
    toolbar: false,
    group: 'project',
    component: lazyNamed(() => import('@/language/ProblemsPanel'), 'ProblemsPanel')
};
