import { lazy, type ComponentType } from 'react';
import type { ExtensionManifest } from '@ruimte/contracts';
import {
    contribute,
    type CanvasLayerContribution,
    type CanvasLayerProps,
    type PanelContribution,
    type SettingsSectionContribution,
    type SharedStorageContribution,
    type ViewAccessoryContribution,
    type ViewAccessoryProps
} from '@/extensions/registry';

/*
 * What only a built-in may call. A built-in runs in the app's own process and may read its stores; the
 * core reaches it through these slots alone, so it never imports one.
 */
export type LazyComponent<Props = {}> = () => Promise<{ default: ComponentType<Props> }>;

export function definePanel(panel: Omit<PanelContribution, 'component'> & { component: LazyComponent }): () => void {
    return contribute('panels', { ...panel, component: lazy(panel.component) });
}

export function defineSettingsPage(page: Omit<SettingsSectionContribution, 'component'> & { component: LazyComponent }): () => void {
    return contribute('settingsSections', { ...page, component: lazy(page.component) });
}

export function defineCanvasLayer(layer: Omit<CanvasLayerContribution, 'component'> & { component: LazyComponent<CanvasLayerProps> }): () => void {
    return contribute('canvasLayers', { ...layer, component: lazy(layer.component) });
}

export function defineViewAccessory(accessory: Omit<ViewAccessoryContribution, 'component'> & { component: LazyComponent<ViewAccessoryProps> }): () => void {
    return contribute('viewAccessories', { ...accessory, component: lazy(accessory.component) });
}

/*
 * A built-in with its manifest, which is what Settings shows, as for any other extension. `setup` holds
 * its `define*` calls, so turning it off takes them out again and turning it on runs them anew.
 */
export function defineBuiltIn(manifest: ExtensionManifest, setup: () => (() => void)[]): void {
    let disposers: (() => void)[] = [];
    const apply = (enabled: boolean): void => {
        disposers.forEach((dispose) => dispose());
        disposers = enabled ? setup() : [];
        writeDisabled(manifest.id, !enabled);
    };

    contribute('builtIns', { id: manifest.id, manifest, setEnabled: apply });

    if (!readDisabled().includes(manifest.id)) {
        disposers = setup();
    }
}

const DISABLED_KEY = 'ruimte.builtIns.disabled';

export function readDisabled(): string[] {
    try {
        const stored: unknown = JSON.parse(localStorage.getItem(DISABLED_KEY) ?? '[]');

        return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string') : [];
    } catch {
        return [];
    }
}

function writeDisabled(id: string, disabled: boolean): void {
    const rest = readDisabled().filter((entry) => entry !== id);

    localStorage.setItem(DISABLED_KEY, JSON.stringify(disabled ? [...rest, id] : rest));
}

/* A storage key meant for the whole app, reread when another window writes it. */
export function defineSharedStorage(storage: SharedStorageContribution): () => void {
    return contribute('sharedStorage', storage);
}
