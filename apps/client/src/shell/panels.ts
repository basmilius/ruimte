import { faCodeBranch, faFolderTree } from '@fortawesome/pro-regular-svg-icons';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import type { PanelKind } from '@/state/ui';

/* The panels the toolbar can open, in the order their buttons sit in. */
export const PANELS: { kind: PanelKind; label: string; icon: IconDefinition }[] = [
    { kind: 'files', label: 'Files', icon: faFolderTree },
    { kind: 'git', label: 'Git', icon: faCodeBranch }
];
