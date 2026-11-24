import { lazyNamed } from '@adecore/ui';
import { CircleDot } from 'lucide-react';
import { ISSUES_PANEL_KIND } from '@/issues/watch';
import type { PanelDefinition } from '@/registry/panels';

export const ISSUES_PANEL: PanelDefinition = {
    id: ISSUES_PANEL_KIND,
    icon: CircleDot,
    minWidth: 360,
    toolbar: true,
    group: 'project',
    component: lazyNamed(() => import('@/issues/IssuesPanel'), 'IssuesPanel')
};
