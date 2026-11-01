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
    id: string;
    label: () => string;
    description: () => string;
    english: string;
}

export interface SettingsSectionContribution {
    id: string;
    icon: LucideIcon;
    group: 'workspace';
    // The core section it comes after, so a built-in stays where a person knows it.
    after: string;
    label: () => string;
    description: () => string;
    english: string;
    component: ComponentType;
    search?: readonly SettingsSearchRow[];
}

export interface Contributions {
    panels: readonly PanelContribution[];
    settingsSections: readonly SettingsSectionContribution[];
}

type ContributionKind = keyof Contributions;
type ContributionOf<Kind extends ContributionKind> = Contributions[Kind][number];

const EMPTY: Contributions = { panels: [], settingsSections: [] };

export const useContributions = create<Contributions>(() => EMPTY);

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
