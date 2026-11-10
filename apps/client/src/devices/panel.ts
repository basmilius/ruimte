import { TabletSmartphone } from 'lucide-react';
import { DevicesPanel } from '@/devices/DevicesPanel';
import type { PanelDefinition } from '@/registry/panels';

export const DEVICES_PANEL: PanelDefinition = {
    id: 'devices',
    icon: TabletSmartphone,
    minWidth: 320,
    toolbar: true,
    group: 'connected',
    component: DevicesPanel
};
