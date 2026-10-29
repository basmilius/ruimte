import { describe, expect, test } from 'bun:test';
import { FIGURE, FLOOR_LEVEL, groundOf, Roam, type Obstacle } from '@/canvas/pets/roam';

const WIDTH = 1200;
const DOCK: Obstacle = { left: 400, right: 800, bottom: 16, top: 60, ledge: true };
const MINIMAP: Obstacle = { left: 980, right: 1184, bottom: 16, top: 160, ledge: false };

/* A random that runs through the same numbers every time. */
function seeded(seed: number): () => number {
    let state = seed;
    return () => {
        state = (state * 1103515245 + 12345) % 2147483648;
        return state / 2147483648;
    };
}

describe('the ground along the bottom of a canvas', () => {
    test('is the floor on either side of the dock and the minimap, and the top of the dock', () => {
        const ground = groundOf(WIDTH, [DOCK, MINIMAP]);
        expect(ground.floors).toEqual([
            { left: 8, right: 400 - FIGURE.w },
            { left: 800, right: 980 - FIGURE.w }
        ]);
        expect(ground.ledge?.level).toBe(58);
        // Only the dock is a step up; the minimap is walked around.
        expect(ground.climbs.map((climb) => climb.floor)).toEqual([400 - FIGURE.w, 800]);
    });

    test('has no room on the dock while a prompt card stands just above it', () => {
        const card: Obstacle = { left: 300, right: 900, bottom: 64, top: 400, ledge: false };
        expect(groundOf(WIDTH, [DOCK, card]).ledge).toBeNull();
    });

    test('runs under what stands higher than a pet, and is the whole floor without a dock', () => {
        const card: Obstacle = { left: 300, right: 900, bottom: 64, top: 400, ledge: false };
        expect(groundOf(WIDTH, [card]).floors).toEqual([{ left: 8, right: WIDTH - 8 - FIGURE.w }]);
    });
});

describe('pets along the bottom of the screen', () => {
    test('start spread over the floor, not in a pile', () => {
        const roam = new Roam(seeded(1));
        const ground = groundOf(WIDTH, [DOCK]);
        for (const id of ['a', 'b', 'c']) {
            roam.join(id, 'idle');
        }
        roam.step(ground, false);
        const xs = ['a', 'b', 'c'].map((id) => roam.spot(id)!.x);
        expect(xs[1] - xs[0]).toBeGreaterThan(FIGURE.w);
        expect(xs[2] - xs[1]).toBeGreaterThan(FIGURE.w);
        expect(['a', 'b', 'c'].every((id) => roam.spot(id)!.y === FLOOR_LEVEL)).toBe(true);
    });

    test('wander, and in time hop onto the dock, and never stand in it', () => {
        const roam = new Roam(seeded(7));
        const ground = groundOf(WIDTH, [DOCK]);
        roam.join('a', 'working');
        let onDock = false;
        for (let i = 0; i < 4000; i++) {
            roam.step(ground, false);
            const spot = roam.spot('a')!;
            if (spot.y === ground.ledge!.level) {
                onDock = true;
            }
            if (spot.y === FLOOR_LEVEL) {
                expect(spot.x + FIGURE.w <= DOCK.left || spot.x >= DOCK.right).toBe(true);
            }
        }
        expect(onDock).toBe(true);
    });

    test('jump over one another rather than walk through', () => {
        const roam = new Roam(seeded(11));
        const ground = groundOf(WIDTH, []);
        roam.join('waiting', 'waiting');
        roam.join('walker', 'working');
        let crossings = 0;
        let side: number | null = null;
        for (let i = 0; i < 6000; i++) {
            roam.step(ground, false);
            const walker = roam.spot('walker')!;
            const now = Math.sign(walker.x - roam.spot('waiting')!.x);
            if (side !== null && now !== 0 && now !== side) {
                crossings += 1;
                // Over its head, not through it.
                expect(walker.y).toBeGreaterThan(FLOOR_LEVEL + FIGURE.h / 2);
            }
            side = now === 0 ? side : now;
        }
        expect(crossings).toBeGreaterThan(0);
    });

    test('never come to rest in one another', () => {
        const roam = new Roam(seeded(13));
        const ground = groundOf(WIDTH, [DOCK]);
        const ids = ['a', 'b', 'c', 'd', 'e'];
        roam.join('waiting', 'waiting');
        for (const id of ids) {
            roam.join(id, 'idle');
        }
        for (let i = 0; i < 6000; i++) {
            roam.step(ground, false);
            const resting = ['waiting', ...ids].map((id) => roam.spot(id)!).filter((spot) => !spot.walking);
            for (const spot of resting) {
                const inside = resting.filter((other) => other !== spot && other.y === spot.y && Math.abs(other.x - spot.x) < FIGURE.w);
                expect(inside).toEqual([]);
            }
        }
    });

    test('one put in another walks off at once', () => {
        const roam = new Roam(seeded(17));
        roam.join('a', 'waiting');
        roam.join('b', 'idle');
        roam.step(groundOf(WIDTH, []), true);
        // A wide box over both puts them on the one bit of floor left, in the same place.
        const narrow = groundOf(WIDTH, [{ left: 200, right: 1150, bottom: 0, top: 200, ledge: false }]);
        roam.step(narrow, true);
        expect(roam.spot('b')!.x).toBe(roam.spot('a')!.x);
        for (let i = 0; i < 40; i++) {
            roam.step(narrow, false);
        }
        expect(Math.abs(roam.spot('b')!.x - roam.spot('a')!.x)).toBeGreaterThanOrEqual(FIGURE.w);
    });

    test('one that waits on you stays where it is', () => {
        const roam = new Roam(seeded(3));
        const ground = groundOf(WIDTH, [DOCK]);
        roam.join('a', 'waiting');
        roam.step(ground, false);
        const first = roam.spot('a');
        for (let i = 0; i < 500; i++) {
            roam.step(ground, false);
        }
        expect(roam.spot('a')).toEqual(first);
    });

    test('jump off the dock when it hides, onto the floor beside it', () => {
        const roam = new Roam(seeded(7));
        const ground = groundOf(WIDTH, [DOCK]);
        roam.join('a', 'working');
        let i = 0;
        while (roam.spot('a')?.y !== ground.ledge!.level && i < 4000) {
            roam.step(ground, false);
            i += 1;
        }
        roam.join('a', 'stopped');
        // The dock comes back over the place it stood, so it takes the nearest floor beside it.
        const crowded = groundOf(WIDTH, [DOCK, { left: 300, right: 900, bottom: 64, top: 400, ledge: false }]);
        for (let step = 0; step < 10; step++) {
            roam.step(crowded, false);
        }
        const spot = roam.spot('a')!;
        expect(spot.y).toBe(FLOOR_LEVEL);
        expect(spot.x + FIGURE.w <= DOCK.left || spot.x >= DOCK.right).toBe(true);
    });

    test('with reduced motion only take their place and never walk', () => {
        const roam = new Roam(seeded(5));
        const ground = groundOf(WIDTH, [DOCK]);
        roam.join('a', 'working');
        roam.step(ground, true);
        const first = roam.spot('a');
        for (let i = 0; i < 500; i++) {
            roam.step(ground, true);
        }
        expect(roam.spot('a')).toEqual(first);
        expect(first?.walking).toBe(false);
    });
});

describe('kids along the bottom of the screen', () => {
    test('start beside their pet, in a row on its ground', () => {
        const roam = new Roam(seeded(1));
        roam.join('a', 'idle');
        roam.follow('kid-0', 'a');
        roam.follow('kid-1', 'kid-0');
        roam.step(groundOf(WIDTH, [DOCK]), false);
        const [pet, first, second] = ['a', 'kid-0', 'kid-1'].map((id) => roam.spot(id)!);
        expect(Math.abs(first.x - pet.x)).toBe(24);
        expect(Math.abs(second.x - first.x)).toBe(24);
        expect([first.y, second.y]).toEqual([pet.y, pet.y]);
    });

    test('walk after their pet, onto the dock as well, and come to rest behind it on its ground, never in the air', () => {
        const roam = new Roam(seeded(7));
        const ground = groundOf(WIDTH, [DOCK]);
        roam.join('a', 'working');
        roam.follow('kid', 'a');
        let onDock = false;
        let rests = 0;
        for (let i = 0; i < 4000; i++) {
            roam.step(ground, false);
            const pet = roam.spot('a')!;
            const kid = roam.spot('kid')!;
            if (kid.walking) {
                continue;
            }
            expect([FLOOR_LEVEL, ground.ledge!.level]).toContain(kid.y);
            onDock ||= kid.y === ground.ledge!.level;
            if (!pet.walking) {
                rests += 1;
                expect(kid.y).toBe(pet.y);
                // A spot is in whole pixels, so a gap of 24 can read one more or less.
                expect(Math.abs(kid.x - pet.x)).toBeGreaterThanOrEqual(11);
                expect(Math.abs(kid.x - pet.x)).toBeLessThanOrEqual(25);
            }
        }
        expect(onDock).toBe(true);
        expect(rests).toBeGreaterThan(0);
    });

    test('rest in a row from their pet, going on at its other side where the ground ends, so no two stand in one place', () => {
        let rests = 0;
        for (const seed of [1, 2, 3, 5, 8, 13]) {
            const roam = new Roam(seeded(seed));
            const ground = groundOf(WIDTH, [DOCK]);
            const row = ['a', 'kid-0', 'kid-1', 'kid-2'];
            roam.join('a', 'working');
            roam.follow('kid-0', 'a');
            roam.follow('kid-1', 'kid-0');
            roam.follow('kid-2', 'kid-1');
            for (let i = 0; i < 4000; i++) {
                roam.step(ground, false);
                const spots = row.map((id) => roam.spot(id)!);
                if (spots.some((spot) => spot.walking)) {
                    continue;
                }
                rests += 1;
                // Every pair, not only a kid and the one ahead of it.
                for (const [index, spot] of spots.entries()) {
                    for (const other of spots.slice(index + 1)) {
                        expect(other.y === spot.y && Math.abs(other.x - spot.x) < 12).toBe(false);
                    }
                }
            }
        }
        expect(rests).toBeGreaterThan(1000);
    });

    test('trail their pet while it walks, and one ahead of it waits for it to pass instead of walking in front', () => {
        let walking = 0;
        let ahead = 0;
        for (const seed of [3, 7, 11, 19, 23]) {
            const roam = new Roam(seeded(seed));
            const ground = groundOf(WIDTH, [DOCK]);
            roam.join('a', 'working');
            roam.follow('kid', 'a');
            let before: number | null = null;
            for (let i = 0; i < 3000; i++) {
                roam.step(ground, false);
                const pet = roam.spot('a')!;
                const kid = roam.spot('kid')!;
                if (pet.walking && kid.y === pet.y && pet.y === FLOOR_LEVEL && before !== null) {
                    walking += 1;
                    if ((kid.x - pet.x) * pet.facing > 0) {
                        ahead += 1;
                        // In front of its pet it holds still, and never walks on ahead of it.
                        expect(kid.x).toBe(before);
                    } else {
                        // Close behind, a little further only while it catches up after a jump of its pet.
                        expect(Math.abs(kid.x - pet.x)).toBeLessThanOrEqual(2 * 24 + 1);
                    }
                }
                before = kid.x;
            }
        }
        expect(walking).toBeGreaterThan(1000);
        // Only while a pet that turned around has not passed it yet.
        expect(ahead / walking).toBeLessThan(0.1);
    });

    test('a kid that comes while its pet walks starts right behind it, not where the walk ends', () => {
        const roam = new Roam(seeded(7));
        const ground = groundOf(WIDTH, []);
        roam.join('a', 'working');
        let i = 0;
        while (roam.spot('a')?.walking !== true && i < 1000) {
            roam.step(ground, false);
            i += 1;
        }
        roam.follow('kid', 'a');
        for (let beat = 0; beat < 40; beat++) {
            roam.step(ground, false);
            const pet = roam.spot('a')!;
            const kid = roam.spot('kid')!;
            if (!pet.walking) {
                break;
            }
            // A gap behind it, give or take the step it took after the kid came.
            expect((kid.x - pet.x) * pet.facing).toBeLessThanOrEqual(0);
            expect(Math.abs(kid.x - pet.x)).toBeLessThanOrEqual(24 + 4 + 1);
        }
    });

    test('one cut off from its pet, with nothing that leads there, jumps across', () => {
        const roam = new Roam(seeded(2));
        // A wall in the middle and no dock: two floors with no way between them.
        const ground = groundOf(WIDTH, [{ left: 560, right: 640, bottom: 0, top: 400, ledge: false }]);
        roam.join('left', 'waiting');
        roam.join('right', 'waiting');
        roam.follow('kid', 'left');
        roam.step(ground, false);
        expect(roam.spot('kid')!.x).toBeLessThan(560);
        roam.follow('kid', 'right');
        for (let i = 0; i < 20; i++) {
            roam.step(ground, false);
        }
        const kid = roam.spot('kid')!;
        expect(kid.x).toBeGreaterThanOrEqual(640);
        expect(kid.walking).toBe(false);
        expect(Math.abs(kid.x - roam.spot('right')!.x)).toBeLessThanOrEqual(25);
    });

    test('are no reason for a pet to jump or to rest elsewhere', () => {
        const alone = new Roam(seeded(11));
        const followed = new Roam(seeded(11));
        const ground = groundOf(WIDTH, [DOCK]);
        alone.join('a', 'working');
        followed.join('a', 'working');
        followed.follow('kid', 'a');
        for (let i = 0; i < 2000; i++) {
            alone.step(ground, false);
            followed.step(ground, false);
            expect(followed.spot('a')).toEqual(alone.spot('a'));
        }
    });

    test('go once their sub-agent ends', () => {
        const roam = new Roam(seeded(3));
        roam.join('a', 'idle');
        roam.follow('kid', 'a');
        roam.step(groundOf(WIDTH, []), false);
        expect(roam.spot('kid')).not.toBeNull();
        roam.leave('kid');
        expect(roam.spot('kid')).toBeNull();
    });

    test('with reduced motion only take their place beside it', () => {
        const roam = new Roam(seeded(5));
        const ground = groundOf(WIDTH, [DOCK]);
        roam.join('a', 'working');
        roam.follow('kid', 'a');
        roam.step(ground, true);
        const first = roam.spot('kid');
        for (let i = 0; i < 500; i++) {
            roam.step(ground, true);
        }
        expect(roam.spot('kid')).toEqual(first);
        expect(first?.walking).toBe(false);
    });
});
