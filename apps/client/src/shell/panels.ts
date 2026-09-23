import { Activity, Folder, GitBranch, TabletSmartphone, type LucideIcon } from 'lucide-react';
import type { PanelKind } from '@/state/ui';

/* The panels, in the order their buttons sit in the toolbar. They share one stored width and each
   clamps it to its own `minWidth` on screen only, so a wide minimum never overwrites it. The name a
   person reads is `panel.names.<kind>`, so the table stays the same in every language. Processes is
   something to look at now and then rather than a place to work, so it opens from the Window menu
   and has no button. */
export const PANELS: { kind: PanelKind; icon: LucideIcon; minWidth: number; toolbar: boolean }[] = [
    { kind: 'files', icon: Folder, minWidth: 240, toolbar: true },
    { kind: 'git', icon: GitBranch, minWidth: 240, toolbar: true },
    { kind: 'devices', icon: TabletSmartphone, minWidth: 320, toolbar: true },
    { kind: 'processes', icon: Activity, minWidth: 420, toolbar: false }
];
