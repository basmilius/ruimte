import { useTranslation } from 'react-i18next';
import { ErrorBoundary, LazyBoundary, lazyNamed } from '@adecore/ui';
import { useLinger } from '@/pets/teleport';
import { useSettings } from '@/state/settings';

const ChatViewPet = lazyNamed(() => import('@/pets/ViewPet'), 'ChatViewPet');
const TerminalViewPet = lazyNamed(() => import('@/pets/ViewPet'), 'TerminalViewPet');

/* Whether a chat or a terminal in a view of its own has its pet: Pets is on, and so is In views of their own. */
function useViewPets(): boolean {
    return useSettings((s) => s.pets && s.petsInViews);
}

/* The pet over a chat view's composer. The figures load only once it can show, so a view without one carries none. */
export function ChatViewPetMount({ id, title }: { id: string; title: string | undefined }) {
    const { t } = useTranslation('canvas');
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

/* The pet in a terminal view's toolbar. */
export function TerminalViewPetMount({ id, title, onPress }: { id: string; title: string | undefined; onPress: () => void }) {
    const { t } = useTranslation('canvas');
    const on = useViewPets();
    const shown = useLinger(on);

    if (!shown) {
        return null;
    }

    return (
        <ErrorBoundary label={t('pets.failed')} resetKeys={[on]} compact>
            <LazyBoundary fallback={null}>
                <TerminalViewPet id={id} title={title} onPress={onPress} leaving={!on} />
            </LazyBoundary>
        </ErrorBoundary>
    );
}
