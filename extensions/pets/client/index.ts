import { defineCanvasOverlay, defineExtensionSettings, defineWidget, storage } from '@ruimte/extension/client';
import { PET_SETTINGS_KEY, usePetSettings } from './pet-settings';
import { petSpritesChanged, PET_SPRITES_KEY } from './sprites-key';

function row(id: string): { id: string; label: string; description: string } {
    return { id: `pets.${id}`, label: `pets.${id}.label`, description: `pets.${id}.description` };
}

defineExtensionSettings({
    component: () => import('./settings/PetsPane'),
    section: {
        group: 'workspace',
        after: 'views',
        icon: 'paw-print',
        label: 'section.label',
        description: 'section.description',
        search: ['enabled', 'place', 'inViews', 'subagents', 'visitor', 'beam', 'sprite', 'custom', 'agents'].map(row)
    }
});
defineCanvasOverlay({ id: 'pets', space: 'canvas', component: () => import('./canvas/CanvasPets').then((module) => ({ default: module.CanvasPets })) });
defineCanvasOverlay({ id: 'pets-roaming', component: () => import('./canvas/CanvasPets').then((module) => ({ default: module.CanvasRoamingPets })) });
defineWidget({ id: 'pets-view', slots: { viewAccessory: true }, component: () => import('./ViewPetWidget') });
// Another window that changes the settings or the figures a person added, which this one follows.
storage.watch(PET_SETTINGS_KEY, () => usePetSettings.getState().reload());
storage.watch(PET_SPRITES_KEY, petSpritesChanged);
