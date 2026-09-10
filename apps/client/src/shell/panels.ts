import { FolderTreeIcon, GitBranchIcon } from '@hugeicons/core-free-icons';
import type { IconSvgElement } from '@hugeicons/react';
import type { PanelKind } from '@/state/ui';

/* The panels the toolbar can open, in the order their buttons sit in. */
export const PANELS: { kind: PanelKind; label: string; icon: IconSvgElement }[] = [
    { kind: 'files', label: 'Files', icon: FolderTreeIcon },
    { kind: 'git', label: 'Git', icon: GitBranchIcon }
];
