import type { ExtensionManifest } from '@ruimte/contracts';
import type { LucideIcon } from 'lucide-react';
import { lazy, type ComponentType } from 'react';
import { z } from 'zod';
import { extensionsInSafeMode } from '@/extensions/safe-mode';
import {
    contribute,
    type BuiltInThemeContribution,
    type CanvasLayerContribution,
    type CanvasLayerProps,
    type SettingsSectionContribution,
    type SharedStorageContribution,
    type ViewAccessoryContribution,
    type ViewAccessoryProps
} from '@/state/extension-registry';
import { storedJson } from '@/state/stored-json';

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

export function defineTheme(theme: BuiltInThemeContribution): () => void {
    return contribute('builtInThemes', theme);
}

/*
 * A built-in with its manifest, which is what Settings shows, as for any other extension. `setup` holds
 * its `define*` calls, so turning it off takes them out again and turning it on runs them anew.
 */
export function defineBuiltIn(manifest: ExtensionManifest, setup: () => (() => void)[], icon?: LucideIcon): void {
    let disposers: (() => void)[] | null = null;
    // Safe mode runs no built-in either, so a person can still turn one off that hangs the app.
    const follow = (enabled: boolean): void => {
        const wanted = enabled && !extensionsInSafeMode();

        if (wanted === (disposers !== null)) {
            return;
        }

        disposers?.forEach((dispose) => dispose());
        disposers = wanted ? setup() : null;
    };

    contribute('builtIns', {
        id: manifest.id,
        manifest,
        setEnabled: (enabled) => {
            follow(enabled);
            writeDisabled(manifest.id, !enabled);
        },
        ...(icon === undefined ? {} : { icon })
    });
    builtInFollowers.set(manifest.id, follow);
    follow(!readDisabled().includes(manifest.id));
}

const DISABLED_KEY = 'ruimte.builtIns.disabled';

const disabledBuiltIns = storedJson<string[]>(DISABLED_KEY, z.array(z.string()));
const builtInFollowers = new Map<string, (enabled: boolean) => void>();

// Another window that turns a built-in on or off writes the list; this one follows without writing it back.
defineSharedStorage({
    id: DISABLED_KEY,
    reload: () => {
        const disabled = readDisabled();

        for (const [id, follow] of builtInFollowers) {
            follow(!disabled.includes(id));
        }
    }
});

export function readDisabled(): string[] {
    return disabledBuiltIns.read() ?? [];
}

function writeDisabled(id: string, disabled: boolean): void {
    const rest = readDisabled().filter((entry) => entry !== id);

    disabledBuiltIns.write(disabled ? [...rest, id] : rest);
}

/* A storage key meant for the whole app, reread when another window writes it. */
export function defineSharedStorage(storage: SharedStorageContribution): () => void {
    return contribute('sharedStorage', storage);
}
