import { useAgent, useLocale, useSubagents, views } from '@ruimte/extension/client';
import { Tooltip } from '@ruimte/extension/ui';
import { petLabel, usePrefersStill } from './figure-support';
import { KID_HEIGHT, KID_PAINT_WIDTH, KID_SPACING, petKidMoods } from './kids';
import { usePetSettings } from './pet-settings';
import { PET_HEIGHT, PET_PAINT_WIDTH, PET_WIDTH, petOf, samePet, WORLD_CELL, type AgentPet } from './pet-state';
import { PetFigure } from './PetFigure';
import { useTeleport, type Teleport } from './teleport';
import { usePetLook } from './use-pet-look';

/* Below this width a composer has no room for a pet beside what it holds, so a narrow cell shows none. */
export const VIEW_PET_MIN_WIDTH = 320;

/* How far in from the right edge of the composer the pet stands, clear of its send button's corner. */
const COMPOSER_INSET = 20;

// Nothing on a view's own pet asks whether another pet stands here, as on a canvas; a task with a pet of its own is not on screen.
const NO_OWN_PETS: ReadonlySet<string> = new Set();

/* Where the composer's card lies in the box of the `viewAccessory` slot. */
export interface ComposerEdge {
    top: number;
    right: number;
    width: number;
}

/* The pet of a chat or a terminal open as a view: the same one its node would have, from the same agent, beamed in and out. */
function useViewPet(id: string, leaving: boolean): { pet: AgentPet | null; beam: Teleport<AgentPet>['beam'] } {
    const agent = useAgent({ id });
    const still = usePrefersStill();
    const { shown, beam } = useTeleport(leaving ? null : petOf(agent), samePet, still);

    return { pet: shown, beam };
}

/*
 * A chat's pet in a view of its own, on the top edge of its composer near the right corner, with the
 * kids of its sub-agents in a row behind it. The composer holds a question while one is open, so the
 * pet stands beside what waits on you. Only the figure takes a press, which hands the keyboard over.
 */
export function ChatViewPet({ id, title, composer, leaving }: { id: string; title: string | undefined; composer: ComposerEdge | null; leaving: boolean }) {
    const { t } = useLocale();
    const { pet, beam } = useViewPet(id, leaving);
    const withKids = usePetSettings((s) => s.petsSubagents);
    const subagents = useSubagents({ id });
    const kids = withKids ? petKidMoods(subagents, NO_OWN_PETS) : [];
    const look = usePetLook(pet?.agent, id);
    const shown = pet !== null && composer !== null && composer.width >= VIEW_PET_MIN_WIDTH;
    const mood = pet?.mood ?? 'idle';
    const label = petLabel(t, { kind: 'chat', title }, mood, 'focus');

    if (!shown) {
        return null;
    }

    return (
        <div
            data-view-pet={id}
            data-pet-mood={mood}
            data-pet-leaving={beam === 'out' || undefined}
            className="pointer-events-none absolute z-20"
            // The bottom row of the paint is the outline under its feet, which lies on the card's top edge.
            style={{ top: composer.top - PET_HEIGHT + WORLD_CELL, right: composer.right + COMPOSER_INSET, width: PET_PAINT_WIDTH, height: PET_HEIGHT }}
        >
            {kids.map((kid, index) => (
                <div
                    key={index}
                    data-pet-kid={beam === 'out' ? undefined : id}
                    data-pet-mood={kid}
                    className="absolute"
                    style={{ left: -(index + 1) * KID_SPACING, top: PET_HEIGHT - KID_HEIGHT }}
                >
                    <PetFigure look={look} mood={kid} crowded={false} small beam={beam} />
                </div>
            ))}
            <div className="relative">
                <PetFigure look={look} mood={mood} crowded={false} beam={beam} />
            </div>
            {/* On its way out it is only a picture, which leads nowhere any more. */}
            {beam !== 'out' && (
                <Tooltip label={label}>
                    <button
                        type="button"
                        data-pet={id}
                        aria-label={label}
                        className="pointer-events-auto absolute left-0 cursor-pointer rounded-md outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        style={{ bottom: WORLD_CELL, width: PET_WIDTH, height: PET_HEIGHT / 2 }}
                        onClick={() => views.focus({ id })}
                    />
                </Tooltip>
            )}
        </div>
    );
}

/*
 * A terminal's pet in a view of its own. The terminal's text takes every pixel of its body, so the pet
 * stands in the band of the cell's toolbar at half its size, its feet on the line under the bar, and the
 * bubble goes beside its head where there is no room over it. A press hands the keyboard to the terminal.
 */
export function TerminalViewPet({ id, title, leaving }: { id: string; title: string | undefined; leaving: boolean }) {
    const { t } = useLocale();
    const { pet, beam } = useViewPet(id, leaving);
    const look = usePetLook(pet?.agent, id);

    if (pet === null) {
        return null;
    }

    const figure = <PetFigure look={look} mood={pet.mood} crowded small beam={beam} />;

    if (beam === 'out') {
        return (
            <span data-pet-leaving="" className="relative shrink-0 self-end" style={{ width: KID_PAINT_WIDTH, height: KID_HEIGHT }} aria-hidden>
                {figure}
            </span>
        );
    }

    const label = petLabel(t, { kind: 'terminal', title }, pet.mood, 'focus');

    return (
        <Tooltip label={label}>
            <button
                type="button"
                data-view-pet={id}
                data-pet-mood={pet.mood}
                aria-label={label}
                className="relative shrink-0 cursor-pointer self-end rounded-md outline-none focus-visible:ring-2 focus-visible:ring-accent"
                style={{ width: KID_PAINT_WIDTH, height: KID_HEIGHT }}
                onClick={() => views.focus({ id })}
            >
                {figure}
            </button>
        </Tooltip>
    );
}
