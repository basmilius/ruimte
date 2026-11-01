import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';
import { create } from 'zustand';

export type PanelGroup = 'project' | 'connected' | 'made' | 'extensions';

export interface PanelContribution {
    kind: `extension:${string}`;
    icon: LucideIcon;
    minWidth: number;
    toolbar: boolean;
    group: PanelGroup;
    label: () => string;
    component: ComponentType;
}

export interface SettingsSearchRow {
    /* The `searchId` of the row it leads to. */
    id: string;
    /* Full i18n keys, namespace included, so a search also finds the English words. */
    label: string;
    description: string;
}

export interface SettingsSectionContribution {
    id: string;
    icon: LucideIcon;
    group: 'workspace';
    // The core section it comes after, so a built-in stays where a person knows it.
    after: string;
    labelKey: string;
    descriptionKey: string;
    component: ComponentType;
    search?: readonly SettingsSearchRow[];
}

export interface CanvasLayerProps {
    z: number;
}

export interface CanvasLayerContribution {
    id: string;
    // On the canvas under the camera, or over it in the cell's overlay.
    place: 'canvas' | 'screen';
    component: ComponentType<CanvasLayerProps>;
}

export interface ViewAccessoryProps {
    id: string;
    title: string | undefined;
    onPress?: () => void;
}

export interface ViewAccessoryContribution {
    id: string;
    on: 'chat' | 'terminal';
    component: ComponentType<ViewAccessoryProps>;
}

export interface SharedStorageContribution {
    id: string;
    reload: () => void;
}

export interface Contributions {
    panels: readonly PanelContribution[];
    settingsSections: readonly SettingsSectionContribution[];
    canvasLayers: readonly CanvasLayerContribution[];
    viewAccessories: readonly ViewAccessoryContribution[];
    sharedStorage: readonly SharedStorageContribution[];
}

type ContributionKind = keyof Contributions;
type ContributionOf<Kind extends ContributionKind> = Contributions[Kind][number];

export const useContributions = create<Contributions>(() => ({
    panels: [],
    settingsSections: [],
    canvasLayers: [],
    viewAccessories: [],
    sharedStorage: []
}));

function idOf(item: { id: string } | { kind: string }): string {
    return 'id' in item ? item.id : item.kind;
}

/* Adds a contribution, or replaces the one with its id when an extension reloads. Answers how to take it out again. */
export function contribute<Kind extends ContributionKind>(kind: Kind, item: ContributionOf<Kind>): () => void {
    const id = idOf(item);

    useContributions.setState((state) => {
        const rest = (state[kind] as readonly ContributionOf<Kind>[]).filter((entry) => idOf(entry) !== id);

        return { [kind]: [...rest, item] } as Partial<Contributions>;
    });

    return () => {
        useContributions.setState(
            (state) =>
                ({
                    [kind]: (state[kind] as readonly ContributionOf<Kind>[]).filter((entry) => entry !== item)
                }) as Partial<Contributions>
        );
    };
}
