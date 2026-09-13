import { Activity, Folder, GitBranch, type LucideIcon } from 'lucide-react';
import type { PanelKind } from '@/state/ui';

/* The panels the toolbar can open, in the order their buttons sit in. */
export const PANELS: { kind: PanelKind; label: string; icon: LucideIcon }[] = [
    { kind: 'files', label: 'Files', icon: Folder },
    { kind: 'git', label: 'Git', icon: GitBranch },
    { kind: 'processes', label: 'Processes', icon: Activity }
];
