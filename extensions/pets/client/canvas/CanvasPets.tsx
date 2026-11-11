import { useLocale } from '@ruimte/extension/client';
import { ErrorBoundary, LazyBoundary, lazyNamed } from '@ruimte/extension/ui';
import { usePetSettings } from '../pet-settings';
import { useLinger } from '../teleport';

const PetLayer = lazyNamed(() => import('./PetLayer'), 'PetLayer');
const PetRoam = lazyNamed(() => import('./PetRoam'), 'PetRoam');

/*
 * Pets, which a person turns on in Settings, Pets, or the visitor that may drop by while they are
 * off. The figures load only once one of the two can show, so a canvas without either carries none.
 */
export function CanvasPets() {
    const { t } = useLocale();
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
                <PetLayer />
            </LazyBoundary>
        </ErrorBoundary>
    );
}

/* Pets along the bottom of the screen, which a person picks in Settings, Pets: over the canvas, in its cell's overlay, under the dock. */
export function CanvasRoamingPets() {
    const { t } = useLocale();
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
