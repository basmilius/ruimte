import { canvas, nodeColorValue, useAgent, useLocale, useNode, useNodes, useSubagents } from '@ruimte/extension/client';
import { Tooltip } from '@ruimte/extension/ui';
import { useEffect, useRef, useState } from 'react';
import { petLabel, usePrefersStill } from '../figure-support';
import { KID_HEIGHT, KID_PAINT_WIDTH, KID_WIDTH, kidId, petKidMoods } from '../kids';
import type { PetLook } from '../paint';
import { usePetSettings } from '../pet-settings';
import { PET_HEIGHT, PET_PAINT_WIDTH, PET_WIDTH, petOf, type PetMood } from '../pet-state';
import { PetFigure } from '../PetFigure';
import { useDeparting, useTeleport } from '../teleport';
import { onPetTick } from '../ticker';
import { usePetLook } from '../use-pet-look';
import { PET_HIT_HEIGHT, PET_HIT_TOP, petNodeKey, sameStanding } from './placement';
import { FIGURE, groundOf, Roam, type Obstacle } from './roam';

function boxOf(element: Element | null | undefined, layer: DOMRect, ledge: boolean): Obstacle | null {
    if (element === null || element === undefined) {
        return null;
    }
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
        return null;
    }
    // Whole pixels, so a box that moves by a fraction does not count as a new ground on every beat.
    return {
        left: Math.round(rect.left - layer.left),
        right: Math.round(rect.right - layer.left),
        bottom: Math.round(layer.bottom - rect.bottom),
        top: Math.round(layer.bottom - rect.top),
        ledge
    };
}

/*
 * What stands at the bottom of this canvas: the floors Ruimte marks in the box its overlay is drawn in
 * (`defineCanvasOverlay`), a ledge such as the dock to stand on and a wall such as the minimap or a
 * prompt card to walk up to.
 */
function obstaclesAround(layer: HTMLElement): Obstacle[] {
    const box = layer.getBoundingClientRect();
    const overlay = layer.closest('[data-canvas-overlay]');
    if (overlay === null) {
        return [];
    }
    return [...overlay.querySelectorAll('[data-canvas-floor]')]
        .map((floor) => {
            const ledge = floor.getAttribute('data-canvas-floor') === 'ledge';
            // A dock that hides on its own fades out, and while it is gone a pet does not stand on air.
            const shown = !ledge || (floor instanceof HTMLElement && Number.parseFloat(getComputedStyle(floor).opacity) > 0.5);
            return shown ? boxOf(floor, box, ledge) : null;
        })
        .filter((obstacle) => obstacle !== null);
}

type OnElement = (id: string, element: HTMLElement | null) => void;

/* A kid of a sub-agent at work, which the layer's `Roam` walks behind `leader`, its pet or the kid ahead of it. Paint only. */
function RoamingKid({
    id,
    leader,
    pet,
    mood,
    look,
    accent,
    roam,
    onElement,
    beam
}: {
    id: string;
    leader: string;
    pet: string;
    mood: PetMood;
    look: PetLook;
    accent: string | undefined;
    roam: Roam;
    onElement: OnElement;
    beam: 'in' | 'out' | undefined;
}) {
    useEffect(() => {
        roam.follow(id, leader);
    }, [roam, id, leader]);

    useEffect(() => () => roam.leave(id), [roam, id]);

    return (
        <div
            ref={(element) => onElement(id, element)}
            data-pet-kid={beam === 'out' ? undefined : pet}
            data-pet-mood={mood}
            className="absolute bottom-0"
            // Its feet where a pet's would be at the same spot, half as far from its left edge.
            style={{ left: FIGURE.feet / 2, width: KID_PAINT_WIDTH, height: KID_HEIGHT, visibility: 'hidden' }}
        >
            <div style={{ transformOrigin: `${KID_WIDTH / 2}px 0` }}>
                <PetFigure look={look} mood={mood} crowded={false} accent={accent} walking={() => roam.spot(id)?.walking === true} small beam={beam} />
            </div>
        </div>
    );
}

/* One pet along the bottom, placed on each beat by the layer's `Roam`, which this tells its mood, with the kids of its sub-agents behind it. */
function RoamingPet({ id, ownPets, roam, onElement, gone }: { id: string; ownPets: ReadonlySet<string>; roam: Roam; onElement: OnElement; gone: boolean }) {
    const { t } = useLocale();
    const info = useNode(id);
    const node = info.kind === 'unknown' ? undefined : info;
    const agent = useAgent({ id });
    const subagents = useSubagents({ id });
    const withKids = usePetSettings((s) => s.petsSubagents);
    const kids = withKids ? petKidMoods(subagents, ownPets) : [];
    const still = usePrefersStill();
    const live = gone || node === undefined ? null : petOf(agent);
    const { shown, beam } = useTeleport(live === null || node === undefined ? null : { node, pet: live }, sameStanding, still);
    const pet = shown?.pet ?? null;
    const look = usePetLook(pet?.agent, id);
    const mood = pet?.mood ?? null;
    const present = mood !== null;

    useEffect(() => {
        if (mood === null) {
            return;
        }
        roam.join(id, mood);
    }, [roam, id, mood]);

    // A node whose agent ended keeps this mounted, and its pet must not stay behind unseen for others to keep clear of.
    useEffect(() => {
        if (!present) {
            return;
        }

        return () => roam.leave(id);
    }, [roam, id, present]);

    const home = shown?.node;

    if (home === undefined || pet === null) {
        return null;
    }

    const label = petLabel(t, home, pet.mood);
    const accent = home.color === null ? undefined : nodeColorValue(home.color);
    const leaving = beam === 'out';

    return (
        <>
            {/* Before their pet, so it walks in front of them. */}
            {kids.map((kid, index) => (
                <RoamingKid
                    key={index}
                    id={kidId(id, index)}
                    leader={index === 0 ? id : kidId(id, index - 1)}
                    pet={id}
                    mood={kid}
                    look={look}
                    accent={accent}
                    roam={roam}
                    onElement={onElement}
                    beam={beam}
                />
            ))}
            <div
                ref={(element) => onElement(id, element)}
                data-pet-roaming={id}
                className="absolute bottom-0 left-0"
                // Out of sight until the layer has placed it, so it never shows in the corner first.
                style={{ width: PET_PAINT_WIDTH, height: PET_HEIGHT, visibility: 'hidden' }}
            >
                {/* Turned around its own middle, so a pet walking left faces left and stays where it stands. */}
                <div style={{ transformOrigin: `${PET_WIDTH / 2}px 0` }}>
                    <PetFigure look={look} mood={pet.mood} crowded={false} accent={accent} walking={() => roam.spot(id)?.walking === true} beam={beam} />
                </div>
                {/* A pet on its way out is only a picture: it leads nowhere any more. */}
                {!leaving && (
                    <Tooltip label={label}>
                        <button
                            type="button"
                            data-pet={id}
                            data-pet-mood={pet.mood}
                            aria-label={label}
                            className="pointer-events-auto absolute left-0 cursor-pointer rounded-md outline-none focus-visible:ring-2 focus-visible:ring-accent"
                            style={{ top: PET_HIT_TOP, width: PET_WIDTH, height: PET_HIT_HEIGHT }}
                            // Drawn over the canvas, which would read a press on a pet as the start of a box or a pan.
                            onPointerDown={(event) => event.stopPropagation()}
                            onDoubleClick={(event) => event.stopPropagation()}
                            onClick={(event) => {
                                event.stopPropagation();
                                canvas.reveal({ id });
                            }}
                        />
                    </Tooltip>
                )}
            </div>
        </>
    );
}

/*
 * The pets of a canvas along the bottom of its screen instead of on their nodes: they wander about,
 * rest in their own pose, and hop onto the dock and off again. One that waits on you or stopped stays
 * where it is. Over the canvas and under the dock, which keeps every press meant for it.
 */
export function PetRoam({ leaving }: { leaving: boolean }) {
    const key = petNodeKey(useNodes());
    // Turned off, every pet beams out where it is; a node removed takes its pet out the same way.
    const { all, gone } = useDeparting(leaving || key === '' ? [] : key.split('\n'));
    const own = new Set(all.filter((id) => !gone.has(id)));
    const layerRef = useRef<HTMLDivElement>(null);
    const [roam] = useState(() => new Roam(Math.random));
    const [elements] = useState(() => new Map<string, HTMLElement>());
    const still = usePrefersStill();

    useEffect(
        () =>
            onPetTick(() => {
                const layer = layerRef.current;
                if (layer === null) {
                    return;
                }
                roam.step(groundOf(layer.clientWidth, obstaclesAround(layer)), still);
                for (const [id, element] of elements) {
                    const spot = roam.spot(id);
                    element.style.visibility = spot === null ? 'hidden' : 'visible';
                    if (spot === null) {
                        continue;
                    }
                    element.style.transform = `translate(${spot.x}px, ${-spot.y}px)`;
                    const figure = element.firstElementChild;
                    if (figure instanceof HTMLElement) {
                        figure.style.transform = spot.facing === -1 ? 'scaleX(-1)' : '';
                    }
                }
            }),
        [roam, elements, still]
    );

    const onElement = (id: string, element: HTMLElement | null): void => {
        if (element === null) {
            elements.delete(id);
            return;
        }
        elements.set(id, element);
    };

    return (
        <div ref={layerRef} data-pet-roam className="pointer-events-none absolute inset-0 overflow-hidden">
            {all.map((id) => (
                <RoamingPet key={id} id={id} ownPets={own} roam={roam} onElement={onElement} gone={gone.has(id)} />
            ))}
        </div>
    );
}
