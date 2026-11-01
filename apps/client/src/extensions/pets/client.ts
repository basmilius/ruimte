import { PawPrint } from 'lucide-react';
import { onPageAsk } from '@/browser/page-asks';
import { defineCanvasLayer, defineSettingsPage, defineSharedStorage, defineViewAccessory } from '@/extensions/internal';
import { PET_SETTINGS_STORAGE_KEY, usePetSettings } from '@/extensions/pets/pet-settings';
import { notePageAsk } from '@/extensions/pets/page-asks';
import { petSpritesChanged, PET_SPRITES_STORAGE_KEY } from '@/extensions/pets/sprites-key';

function row(id: string): { id: string; label: string; description: string } {
    return { id: `pets.${id}`, label: `pets:pets.${id}.label`, description: `pets:pets.${id}.description` };
}

defineSettingsPage({
    id: 'pets',
    icon: PawPrint,
    group: 'workspace',
    after: 'views',
    labelKey: 'pets:section.label',
    descriptionKey: 'pets:section.description',
    component: () => import('@/extensions/pets/settings/PetsPage'),
    search: ['enabled', 'place', 'inViews', 'subagents', 'visitor', 'beam', 'sprite', 'custom', 'agents'].map(row)
});

defineCanvasLayer({ id: 'pets', place: 'canvas', component: () => import('@/extensions/pets/canvas/CanvasPetLayer') });
defineCanvasLayer({ id: 'pets-roaming', place: 'screen', component: () => import('@/extensions/pets/canvas/CanvasRoamingPets') });
defineViewAccessory({ id: 'pets-chat', on: 'chat', component: () => import('@/extensions/pets/ChatViewPetAccessory') });
defineViewAccessory({ id: 'pets-terminal', on: 'terminal', component: () => import('@/extensions/pets/TerminalViewPetAccessory') });
defineSharedStorage({ id: PET_SETTINGS_STORAGE_KEY, reload: () => usePetSettings.getState().reload() });
defineSharedStorage({ id: PET_SPRITES_STORAGE_KEY, reload: petSpritesChanged });

onPageAsk(notePageAsk);
