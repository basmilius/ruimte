import type { ExtensionManifest } from '@ruimte/contracts';
import type { LucideIcon } from 'lucide-react';
import { lazy, type ComponentType } from 'react';
import { defineBuiltIn as defineBuiltInExtension } from '@/extensions/built-ins';
import {
    contribute,
    type CanvasLayerContribution,
    type CanvasLayerProps,
    type SettingsSectionContribution,
    type SharedStorageContribution,
    type ViewAccessoryContribution,
    type ViewAccessoryProps
} from '@/state/extension-registry';

/*
 * What only a built-in may call. A built-in runs in the app's own process and may read its stores; the
 * core reaches it through these slots alone, so it never imports one.
 */
export type LazyComponent<Props = {}> = () => Promise<{ default: ComponentType<Props> }>;

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
export function defineBuiltIn(manifest: ExtensionManifest, setup: () => (() => void)[], icon?: LucideIcon): void {
    defineBuiltInExtension({ manifest, setup, ...(icon === undefined ? {} : { icon }) });
}

/* A storage key meant for the whole app, reread when another window writes it. */
export function defineSharedStorage(storage: SharedStorageContribution): () => void {
    return contribute('sharedStorage', storage);
}
