import { Activity, Folder, GitBranch, TabletSmartphone, type LucideIcon } from 'lucide-react';
import type { PanelKind } from '@/state/ui';

/* The panels the toolbar can open, in the order their buttons sit in. They share one stored width
   and each clamps it to its own `minWidth` on screen only, so a wide minimum never overwrites it. */
export const PANELS: { kind: PanelKind; label: string; icon: LucideIcon; minWidth: number }[] = [
    { kind: 'files', label: 'Files', icon: Folder, minWidth: 240 },
    { kind: 'git', label: 'Git', icon: GitBranch, minWidth: 240 },
    { kind: 'devices', label: 'Devices', icon: TabletSmartphone, minWidth: 320 },
    { kind: 'processes', label: 'Processes', icon: Activity, minWidth: 420 }
];
