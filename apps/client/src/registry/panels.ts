import type { LucideIcon } from 'lucide-react';
import type { ComponentType } from 'react';
import { createRegistry } from './create-registry';

export type PanelGroup = 'project' | 'connected' | 'made';

/* How the project's file keeps the panel that was open: beside `panel`, in a key an older client ignores. */
type StoredPanelFlag = 'launchesPanel' | 'databasesPanel' | 'outputPanel';

/* A panel of the side column. The feature that draws it registers it, and the frame lists what was registered. */
export interface PanelDefinition {
    /* The kind, which is also the part of its words under `shell:panel.names.<id>`. */
    readonly id: string;
    readonly icon: LucideIcon;
    /* The width it clamps the shared stored width to on screen only. */
    readonly minWidth: number;
    /* Has a button in the rail. One without opens from a menu and closes from its own header. */
    readonly toolbar: boolean;
    readonly group: PanelGroup;
    /* The Chats project has no place for it: its folder is the daemon's, and so are its repository and what runs in it. */
    readonly hiddenInScratch?: boolean;
    /* A button elsewhere toggles it, so the column shows no close button of its own. */
    readonly togglesElsewhere?: boolean;
    /* Open only for this session: the file stores it as closed, since what it shows does not outlive the window. */
    readonly sessionOnly?: boolean;
    /* A kind the file does not know: it is stored as the files panel plus this key. */
    readonly storedAs?: StoredPanelFlag;
    readonly component: ComponentType;
}

export const panelRegistry = createRegistry<PanelDefinition>('panel');
