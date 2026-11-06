import { lazyNamed } from '@adecore/ui';
import { Database } from 'lucide-react';
import type { PanelDefinition } from '@/registry/panels';

export const DATABASES_PANEL: PanelDefinition = {
    id: 'databases',
    icon: Database,
    minWidth: 260,
    toolbar: true,
    group: 'connected',
    hiddenInScratch: true,
    storedAs: 'databasesPanel',
    component: lazyNamed(() => import('@/database/DatabasesPanel'), 'DatabasesPanel')
};
