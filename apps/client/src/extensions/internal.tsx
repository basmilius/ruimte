import { lazy, type ComponentType } from 'react';
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

/* A storage key meant for the whole app, reread when another window writes it. */
export function defineSharedStorage(storage: SharedStorageContribution): () => void {
    return contribute('sharedStorage', storage);
}
