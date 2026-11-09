import { Folder } from 'lucide-react';
import { FilesPanel } from '@/files/FilesPanel';
import type { PanelDefinition } from '@/registry/panels';

export const FILES_PANEL: PanelDefinition = {
    id: 'files',
    icon: Folder,
    minWidth: 240,
    toolbar: true,
    group: 'project',
    component: FilesPanel
};
