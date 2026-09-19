import { Activity, Folder, GitBranch, TabletSmartphone, type LucideIcon } from 'lucide-react';
import type { PanelKind } from '@/state/ui';

/* The panels the toolbar can open, in the order their buttons sit in. They share one stored width
   and each clamps it to its own `minWidth` on screen only, so a wide minimum never overwrites it.
   The name a person reads is `panel.names.<kind>`, so the table stays the same in every language. */
export const PANELS: { kind: PanelKind; icon: LucideIcon; minWidth: number }[] = [
    { kind: 'files', icon: Folder, minWidth: 240 },
    { kind: 'git', icon: GitBranch, minWidth: 240 },
    { kind: 'devices', icon: TabletSmartphone, minWidth: 320 },
    { kind: 'processes', icon: Activity, minWidth: 420 }
];
