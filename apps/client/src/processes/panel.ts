import { Activity } from 'lucide-react';
import { ProcessesPanel } from '@/processes/ProcessesPanel';
import type { PanelDefinition } from '@/registry/panels';

export const PROCESSES_PANEL: PanelDefinition = { id: 'processes', icon: Activity, minWidth: 420, toolbar: false, group: 'project', component: ProcessesPanel };
