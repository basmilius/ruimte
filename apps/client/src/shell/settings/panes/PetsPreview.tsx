import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePetSprites } from '@/pets/custom-sprites';
import { usePrefersStill } from '@/pets/figure-support';
import { KID_HEIGHT, KID_SPACING } from '@/pets/kids';
import { PetFigure } from '@/pets/PetFigure';
import { PET_HEIGHT, PET_PAINT_WIDTH, petChoiceOfKey, WORLD_CELL, type PetMood } from '@/pets/pet-state';
import type { PetPose } from '@/pets/pixel';
import { lookOf, usePetPool } from '@/pets/use-pet-look';
import { useSettings } from '@/state/settings';

/* The moods the preview runs through, a few seconds each. First the one reduced motion holds, so its one frame shows the bubble. */
const MOODS: readonly PetMood[] = ['waiting', 'working', 'idle', 'stopped'];
const MOOD_MS = 3200;

/* The words of a mood, from the states a figure of your own has a strip for. */
const MOOD_STATES: Partial<Record<PetMood, PetPose>> = { waiting: 'wait', working: 'work', idle: 'sleep', stopped: 'stopped' };

/* Two nodes of a canvas, a Claude chat and a Codex terminal, each with the pet it would have. */
const SLOTS = [
    { agent: 'claude', left: '8%' },
    { agent: 'codex', left: '56%' }
] as const;

const PREVIEW_HEIGHT = 188;
const NODE_WIDTH = '34%';
const NODE_HEIGHT = 64;
// The nodes hang from the top, so a pet on a node stands on its top edge and one along the bottom walks under it.
const NODE_TOP = 60;
const NODE_EDGE = PREVIEW_HEIGHT - NODE_TOP;
const FLOOR_HEIGHT = 14;
const PET_INSET = 12;

function usePreviewMood(still: boolean): number {
    const [step, setStep] = useState(0);

    useEffect(() => {
        if (still) {
            return;
        }

        const timer = setInterval(() => setStep((current) => current + 1), MOOD_MS);

        return () => clearInterval(timer);
    }, [still]);

    return still ? 0 : step;
}

function MiniNode({ left, title }: { left: string; title: string }) {
    return (
        <div className="absolute rounded-lg border border-border bg-surface" style={{ left, top: NODE_TOP, width: NODE_WIDTH, height: NODE_HEIGHT }}>
            <div className="truncate border-b border-border px-2 py-1 text-xs text-text-muted">{title}</div>
        </div>
    );
}

/*
 * What the page's choices put on a canvas, running through every mood on its own: two nodes with their
 * pets from the sets picked, on their nodes or along the bottom, and the kids of sub-agents while they
 * work. It shows the pets on also while they are off, as the invitation to turn them on. It is a picture
 * and takes nothing: no press, no focus, no reading.
 */
export function PetsPreview() {
    const { t } = useTranslation('settings');
    const place = useSettings((s) => s.petsPlace);
    const withKids = useSettings((s) => s.petsSubagents);
    const sprites = usePetSprites((s) => s.sprites);
    const pool = usePetPool();
    const byAgent = useSettings((s) => s.petsByAgent);
    const customIds = sprites.map((sprite) => sprite.id);
    const still = usePrefersStill();
    const step = usePreviewMood(still);
    const mood = MOODS[step % MOODS.length];
    const state = MOOD_STATES[mood];
    const onNodes = place === 'nodes';

    const petAt = (slot: number) => {
        const { agent, left } = SLOTS[slot];
        // The figure its CLI was given, or else the next set picked, so two sets show side by side as they would spread over a canvas.
        const given = byAgent[agent] === undefined ? null : petChoiceOfKey(byAgent[agent], customIds);
        const look = lookOf(given ?? pool[slot % pool.length], agent, sprites, `preview-${slot}`);
        const own = slot === 0 ? mood : MOODS[(step + 1) % MOODS.length];
        const kids = slot === 0 && withKids && own === 'working' ? 2 : 0;

        return (
            <div
                key={agent}
                className="absolute"
                style={{
                    left: `calc(${left} + ${NODE_WIDTH} - ${PET_PAINT_WIDTH + PET_INSET}px)`,
                    // The bottom row of the paint is the outline under its feet, on the node's top edge or on the floor.
                    bottom: (onNodes ? NODE_EDGE : FLOOR_HEIGHT) - WORLD_CELL,
                    width: PET_PAINT_WIDTH,
                    height: PET_HEIGHT
                }}
            >
                {Array.from({ length: kids }, (_, index) => (
                    <div key={index} className="absolute" style={{ left: -(index + 1) * KID_SPACING, top: PET_HEIGHT - KID_HEIGHT }}>
                        <PetFigure look={look} mood="working" crowded={false} small />
                    </div>
                ))}
                <div className="relative">
                    <PetFigure look={look} mood={own} crowded={false} />
                </div>
            </div>
        );
    };

    return (
        <div
            aria-hidden
            inert
            data-pets-preview=""
            // The pane is a column that scrolls, where a box that clips would shrink to nothing.
            style={{ height: PREVIEW_HEIGHT }}
            className="pointer-events-none relative shrink-0 select-none overflow-hidden rounded-xl border border-border bg-surface-idle"
        >
            {state !== undefined && <span className="absolute top-2 right-3 text-xs text-text-faint">{t(`pets.custom.states.${state}`)}</span>}
            <MiniNode left={SLOTS[0].left} title="Claude" />
            <MiniNode left={SLOTS[1].left} title="Codex" />
            {!onNodes && <div className="absolute inset-x-0 bottom-0 border-t border-border bg-surface" style={{ height: FLOOR_HEIGHT }} />}
            {SLOTS.map((_, slot) => petAt(slot))}
        </div>
    );
}
