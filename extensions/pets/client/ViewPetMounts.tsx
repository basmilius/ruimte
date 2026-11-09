import { ErrorBoundary, LazyBoundary, lazyNamed } from '@adecore/ui';
import { usePetSettings } from '@extensions/pets/client/pet-settings';
import { useLinger } from '@extensions/pets/client/teleport';
import { useTranslation } from 'react-i18next';

const ChatViewPet = lazyNamed(() => import('@extensions/pets/client/ViewPet'), 'ChatViewPet');
const TerminalViewPet = lazyNamed(() => import('@extensions/pets/client/ViewPet'), 'TerminalViewPet');

function noop(): void {}

function useViewPets(): boolean {
    return usePetSettings((s) => s.pets && s.petsInViews);
}

/* The pet over a chat view's composer. The figures load only once it can show, so a view without one carries none. */
export function ChatViewPetMount({ id, title }: { id: string; title: string | undefined }) {
    const { t } = useTranslation('pets');
    const on = useViewPets();
    // Turned off, the pet stays a beam's length and beams out.
    const shown = useLinger(on);

    if (!shown) {
        return null;
    }

    return (
        // Turning it off and on again tries once more after a failure.
        <ErrorBoundary label={t('pets.failed')} resetKeys={[on]} compact>
            <LazyBoundary fallback={null}>
                <ChatViewPet id={id} title={title} leaving={!on} />
            </LazyBoundary>
        </ErrorBoundary>
    );
}

export function TerminalViewPetMount({ id, title, onPress }: { id: string; title: string | undefined; onPress?: () => void }) {
    const { t } = useTranslation('pets');
    const on = useViewPets();
    const shown = useLinger(on);

    if (!shown) {
        return null;
    }

    return (
        <ErrorBoundary label={t('pets.failed')} resetKeys={[on]} compact>
            <LazyBoundary fallback={null}>
                <TerminalViewPet id={id} title={title} onPress={onPress ?? noop} leaving={!on} />
            </LazyBoundary>
        </ErrorBoundary>
    );
}
