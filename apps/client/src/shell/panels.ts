import type { LucideIcon } from 'lucide-react';
import type { ComponentType } from 'react';
import { panelRegistry, type PanelDefinition } from '@/registry/panels';
import { useContributions, type PanelContribution, type PanelGroup } from '@/state/extension-registry';
import { panelHidden, type PanelKind } from '@/state/ui';

export type { PanelGroup };

/* A panel of the side column: a feature's (`registry/panels.ts`) or an extension's. */
interface PanelEntry {
    readonly kind: string;
    readonly icon: LucideIcon;
    readonly minWidth: number;
    readonly toolbar: boolean;
    readonly group: PanelGroup;
    readonly togglesElsewhere: boolean;
    readonly component: ComponentType;
    /* The words of an extension's panel; a feature's are under `shell:panel.names.<kind>`. */
    readonly label?: () => string;
    readonly badge?: () => string | null;
}

function entryOfDefinition(definition: PanelDefinition): PanelEntry {
    return {
        kind: definition.id,
        icon: definition.icon,
        minWidth: definition.minWidth,
        toolbar: definition.toolbar,
        group: definition.group,
        togglesElsewhere: definition.togglesElsewhere === true,
        component: definition.component
    };
}

function entryOfContribution(contribution: PanelContribution): PanelEntry {
    return { ...contribution, togglesElsewhere: false };
}

/*
 * The panels, in the order their buttons sit in the toolbar: the features' in the order they registered,
 * then the extensions'. They share one stored width and each clamps it to its own `minWidth` on screen
 * only, so a wide minimum never overwrites it.
 */
function entriesOf(registered: readonly PanelDefinition[], contributed: readonly PanelContribution[]): readonly PanelEntry[] {
    return [...registered.map(entryOfDefinition), ...contributed.map(entryOfContribution)];
}

export function usePanelEntries(): readonly PanelEntry[] {
    return entriesOf(
        panelRegistry.useAll(),
        useContributions((state) => state.panels)
    );
}

/* Whether a button in the rail toggles the panel: one of the panel buttons, or one a button elsewhere toggles. The rest open from a menu and close from their own header. */
export function closesFromRail(kind: PanelKind): boolean {
    return entriesOf(panelRegistry.all(), useContributions.getState().panels).some((entry) => entry.kind === kind && (entry.toolbar || entry.togglesElsewhere));
}

/* The panels with a button in the rail of a project, which the Chats project has fewer of. */
export function useToolbarPanels(scratch: boolean): readonly PanelEntry[] {
    return usePanelEntries().filter((entry) => entry.toolbar && !panelHidden(entry.kind, scratch));
}
