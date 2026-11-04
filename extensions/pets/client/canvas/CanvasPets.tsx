import { ErrorBoundary, LazyBoundary, lazyNamed } from '@adecore/ui';
import { usePetSettings } from '@extensions/pets/client/pet-settings';
import { useLinger } from '@extensions/pets/client/teleport';
import { useTranslation } from 'react-i18next';

const PetLayer = lazyNamed(() => import('@extensions/pets/client/canvas/PetLayer'), 'PetLayer');
const PetRoam = lazyNamed(() => import('@extensions/pets/client/canvas/PetRoam'), 'PetRoam');

/*
 * Pets, which a person turns on in Settings, Pets, or the visitor that may drop by while they are
 * off. The figures load only once one of the two can show, so a canvas without either carries none.
 */
export function CanvasPets({ z }: { z: number }) {
    const { t } = useTranslation('pets');
    const pets = usePetSettings((s) => s.pets);
    const visitor = usePetSettings((s) => s.petsVisitor);
    // Turned off, the layer stays a beam's length, so its pets beam out.
    const shown = useLinger(pets || visitor);

    if (!shown) {
        return null;
    }

    return (
        // Turning either one off and on again tries once more after a failure.
        <ErrorBoundary label={t('pets.failed')} resetKeys={[pets, visitor]} compact>
            <LazyBoundary>
                <PetLayer z={z} />
            </LazyBoundary>
        </ErrorBoundary>
    );
}

/* Pets along the bottom of the screen, which a person picks in Settings, Pets: over the canvas, in its cell's overlay, under the dock. */
export function CanvasRoamingPets() {
    const { t } = useTranslation('pets');
    const roaming = usePetSettings((s) => s.pets && s.petsPlace === 'screen');
    const shown = useLinger(roaming);

    if (!shown) {
        return null;
    }

    return (
        <ErrorBoundary label={t('pets.failed')} resetKeys={[roaming]} compact>
            <LazyBoundary>
                <PetRoam leaving={!roaming} />
            </LazyBoundary>
        </ErrorBoundary>
    );
}
