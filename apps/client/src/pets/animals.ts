import { bow, cell, crossEye, emptyParts, flipped, laptop, snore, type DrawnSprite, type Parts } from '@/pets/pixel';
import { FOX, FROG } from '@/pets/sprite-colors';

type AnimalPose = 'stand' | 'walk' | 'work' | 'wait' | 'sleep' | 'fallen';

/* A fox from the side, in warm orange: the animal for Claude. */
function foxParts(pose: AnimalPose, frame: number): Parts {
    const parts = emptyParts();
    const { silhouette, details } = parts;
    if (pose === 'stand' || pose === 'walk' || pose === 'fallen') {
        silhouette.push(cell(1, 8, 3, 4, FOX.body), cell(2, 11, 3, 2, FOX.body), cell(1, 7, 2, 2, FOX.cream));
        silhouette.push(cell(4, 10, 9, 4, FOX.body));
        [5, 11].forEach((leg, i) => {
            // Walking, one leg is up and then the other.
            const lift = pose === 'walk' && i === frame % 2 ? 1 : 0;
            silhouette.push(cell(leg, 14, 2, 3 - lift, FOX.body));
            details.push(cell(leg, 16 - lift, 2, 1, FOX.sock));
        });
        silhouette.push(cell(12, 5, 6, 5, FOX.body), cell(12, 3, 2, 2, FOX.body), cell(15, 3, 2, 2, FOX.body), cell(17, 8, 2, 2, FOX.cream));
        details.push(cell(14, 8, 3, 2, FOX.cream), cell(6, 12, 6, 2, FOX.cream), cell(13, 4, 1, 1, FOX.pink), cell(16, 4, 1, 1, FOX.pink));
        details.push(cell(18, 8, 1, 1, FOX.ink), cell(4, 10, 1, 1, FOX.shade), cell(12, 9, 1, 1, FOX.shade));
        details.push(...(pose === 'fallen' ? crossEye(15, 6, FOX.ink) : [cell(15, 6, 1, 1, FOX.ink)]));
        parts.bow = bow(15, 4);
        return parts;
    }
    if (pose === 'sleep') {
        const breath = frame % 2;
        silhouette.push(cell(2, 13, 3, 4, FOX.body), cell(4, 12 - breath, 11, 5 + breath, FOX.body));
        silhouette.push(cell(13, 12, 6, 5, FOX.body), cell(13, 10, 2, 2, FOX.body), cell(16, 10, 2, 2, FOX.body), cell(18, 14, 2, 2, FOX.cream));
        silhouette.push(cell(8, 15, 6, 2, FOX.cream));
        details.push(cell(15, 14, 2, 1, FOX.ink), cell(19, 14, 1, 1, FOX.ink), cell(14, 11, 1, 1, FOX.pink), cell(16, 11, 1, 1, FOX.pink));
        details.push(cell(5, 13 - breath, 1, 1, FOX.shade), cell(12, 13, 1, 3, FOX.shade));
        parts.bow = bow(16, 11);
        parts.props.push(...snore(19, frame));
        return parts;
    }
    // Sitting up, to type or to wait, its tail swishing while it waits.
    const tail = pose === 'wait' && frame % 4 >= 2 ? 1 : 0;
    silhouette.push(cell(2, 12 - tail, 4, 3, FOX.body), cell(1, 11 - tail, 2, 2, FOX.cream));
    silhouette.push(cell(5, 10, 7, 7, FOX.body), cell(10, 8, 4, 7, FOX.body));
    silhouette.push(cell(10, 3, 6, 5, FOX.body), cell(10, 1, 2, 2, FOX.body), cell(14, 1, 2, 2, FOX.body), cell(15, 6, 2, 2, FOX.cream));
    silhouette.push(cell(11, 15, 3, 2, FOX.body));
    details.push(cell(12, 9, 2, 4, FOX.cream), cell(13, 6, 2, 2, FOX.cream), cell(11, 2, 1, 1, FOX.pink), cell(14, 2, 1, 1, FOX.pink));
    details.push(cell(16, 6, 1, 1, FOX.ink), cell(11, 16, 3, 1, FOX.sock), cell(5, 10, 1, 1, FOX.shade));
    if (pose === 'work') {
        const paw = frame % 2;
        silhouette.push(cell(13, 12 - paw, 2, 1, FOX.body));
        details.push(cell(15, 12 - paw, 1, 1, FOX.cream), cell(14, 5, 1, 1, FOX.ink));
        parts.props.push(...laptop(15, frame));
    } else {
        silhouette.push(cell(13, 10, 2, 1, FOX.body));
        details.push(cell(14, 4, 1, 1, FOX.ink));
    }
    parts.bow = bow(13, 2);
    return parts;
}

/* A frog from the side, in green: the animal for Codex. */
function frogParts(pose: AnimalPose, frame: number): Parts {
    const parts = emptyParts();
    const { silhouette, details } = parts;
    if (pose === 'sleep') {
        const breath = frame % 2;
        silhouette.push(cell(2, 13, 5, 4, FROG.body), cell(3, 12 - breath, 12, 5 + breath, FROG.body), cell(9, 11, 9, 6, FROG.body));
        silhouette.push(cell(10, 9, 3, 2, FROG.body), cell(14, 9, 3, 2, FROG.body));
        details.push(cell(10, 10, 3, 1, FROG.outline), cell(14, 10, 3, 1, FROG.outline), cell(12, 14, 5, 1, FROG.outline));
        details.push(cell(5, 13 - breath, 2, 1, FROG.spot), cell(8, 12 - breath, 2, 1, FROG.spot));
        parts.bow = bow(6, 12 - breath);
        parts.props.push(...snore(19, frame));
        return parts;
    }
    silhouette.push(cell(4, 8, 9, 1, FROG.body), cell(3, 9, 11, 8, FROG.body));
    silhouette.push(cell(9, 6, 9, 6, FROG.body), cell(10, 3, 3, 3, FROG.body), cell(14, 3, 3, 3, FROG.body));
    silhouette.push(cell(2, 12, 5, 5, FROG.body), cell(14, 13, 2, 4, FROG.body), cell(14, 16, 4, 1, FROG.body));
    details.push(cell(11, 3, 2, 2, FROG.white), cell(15, 3, 2, 2, FROG.white));
    details.push(cell(12, 10, 6, 1, FROG.outline), cell(12, 11, 5, 2, FROG.cream));
    details.push(cell(5, 10, 2, 1, FROG.spot), cell(8, 9, 2, 1, FROG.spot), cell(4, 13, 2, 1, FROG.spot), cell(9, 13, 1, 1, FROG.spot));
    if (pose === 'fallen') {
        details.push(cell(11, 3, 1, 1, FROG.ink), cell(12, 4, 1, 1, FROG.ink), cell(15, 3, 1, 1, FROG.ink), cell(16, 4, 1, 1, FROG.ink));
    } else if (pose === 'wait') {
        // Looking up at you, one hand raised.
        details.push(cell(12, 3, 1, 1, FROG.ink), cell(16, 3, 1, 1, FROG.ink));
        silhouette.push(cell(16, 10 - (frame % 2), 2, 1, FROG.body));
    } else if (pose === 'work') {
        const hand = frame % 2;
        details.push(cell(12, 4, 1, 1, FROG.ink), cell(16, 4, 1, 1, FROG.ink));
        silhouette.push(cell(16, 12 - hand, 3, 1, FROG.body));
        parts.props.push(...laptop(18, frame));
    } else {
        details.push(cell(12, 4, 1, 1, FROG.ink), cell(16, 4, 1, 1, FROG.ink));
    }
    // Its eyes take the top of its head, so the bow sits on the back of it.
    parts.bow = bow(7, 8);
    if (pose === 'walk' && frame % 2 === 1) {
        // A frog hops along rather than walks.
        const up = <T extends { y: number }>(cells: T[]): T[] => cells.map((part) => ({ ...part, y: part.y - 1 }));
        return { silhouette: up(parts.silhouette), details: up(parts.details), props: up(parts.props), bow: up(parts.bow) };
    }
    return parts;
}

function animal(id: string, outline: string, partsOf: (pose: AnimalPose, frame: number) => Parts): DrawnSprite {
    return {
        id,
        outline,
        poses: {
            stand: (frame) => partsOf('stand', frame),
            walk: (frame) => partsOf('walk', frame),
            work: (frame) => partsOf('work', frame),
            wait: (frame) => partsOf('wait', frame),
            sleep: (frame) => partsOf('sleep', frame),
            stopped: (frame) => flipped(partsOf('fallen', frame), 3)
        }
    };
}

export const FOX_SPRITE = animal('fox', FOX.outline, foxParts);

export const FROG_SPRITE = animal('frog', FROG.outline, frogParts);
