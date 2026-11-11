import { useLocale, useViews, type ContextOf } from '@ruimte/extension/client';
import { ErrorBoundary, LazyBoundary, lazyNamed } from '@ruimte/extension/ui';
import { usePetSettings } from './pet-settings';
import { useLinger } from './teleport';

const ChatViewPet = lazyNamed(() => import('./ViewPet'), 'ChatViewPet');
const TerminalViewPet = lazyNamed(() => import('./ViewPet'), 'TerminalViewPet');

/*
 * The pet of a chat or a terminal open as a view of its own, beside it in the `viewAccessory` slot. The figures load
 * only once it can show, so a view without one carries none.
 */
export default function ViewPetWidget({ context }: { context: ContextOf<'viewAccessory'> }) {
    const { t } = useLocale();
    const { target, composer } = context;
    const on = usePetSettings((s) => s.pets && s.petsInViews);
    const title = useViews().find((view) => view.id === target.id)?.name;
    // Turned off, the pet stays a beam's length and beams out.
    const shown = useLinger(on);

    if (!shown) {
        return null;
    }

    return (
        // Turning it off and on again tries once more after a failure.
        <ErrorBoundary label={t('pets.failed')} resetKeys={[on]} compact>
            <LazyBoundary fallback={null}>
                {target.kind === 'chat' ? (
                    <ChatViewPet id={target.id} title={title} composer={composer} leaving={!on} />
                ) : (
                    <TerminalViewPet id={target.id} title={title} leaving={!on} />
                )}
            </LazyBoundary>
        </ErrorBoundary>
    );
}
