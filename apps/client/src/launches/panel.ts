import { lazyNamed } from '@adecore/ui';
import { Rocket } from 'lucide-react';
import type { PanelDefinition } from '@/registry/panels';

export const LAUNCHES_PANEL: PanelDefinition = {
    id: 'launches',
    icon: Rocket,
    minWidth: 480,
    toolbar: false,
    group: 'project',
    component: lazyNamed(() => import('@/launches/LaunchesPanel'), 'LaunchesPanel')
};
