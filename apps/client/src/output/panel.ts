import { lazyNamed } from '@adecore/ui';
import { Package } from 'lucide-react';
import type { PanelDefinition } from '@/registry/panels';

export const OUTPUT_PANEL: PanelDefinition = {
    id: 'output',
    icon: Package,
    minWidth: 300,
    toolbar: true,
    group: 'made',
    component: lazyNamed(() => import('@/output/OutputPanel'), 'OutputPanel')
};
