import type { LucideIcon } from 'lucide-react';
import type { ComponentType } from 'react';
import { createRegistry } from './create-registry';

export type PanelGroup = 'project' | 'connected' | 'made';

/* How the file stores a kind, and whether the Chats project shows it, are in `state/panel-traits.ts`, which is there before the workspace's chunk. */
export interface PanelDefinition {
    /* The kind, which is also the part of its words under `shell:panel.names.<id>`. */
    readonly id: string;
    readonly icon: LucideIcon;
    /* The width it clamps the shared stored width to on screen only. */
    readonly minWidth: number;
    /* Has a button in the rail. One without opens from a menu and closes from its own header. */
    readonly toolbar: boolean;
    readonly group: PanelGroup;
    /* A button elsewhere toggles it, so the column shows no close button of its own. */
    readonly togglesElsewhere?: boolean;
    readonly component: ComponentType;
}

export const panelRegistry = createRegistry<PanelDefinition>('panel');
