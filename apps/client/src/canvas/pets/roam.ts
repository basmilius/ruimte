import type { PetMood } from '@/pets/pet-state';

/* A box over the bottom of a canvas that a pet keeps out of, in pixels from the layer's left edge and up from its bottom. */
export interface Obstacle {
    left: number;
    right: number;
    bottom: number;
    top: number;

    /* Whether a pet may stand on it: the dock, never the minimap or a prompt card. */
    ledge: boolean;
}

/* A range of a figure's left edge. */
export interface Span {
    left: number;
    right: number;
}

/* Where pets may stand: stretches of the floor between what stands on it, and the top of the dock while there is room over it. */
export interface Ground {
    floors: Span[];
    ledge: (Span & { level: number }) | null;

    /* The figure's left edge on the floor at either end of the dock, and on the dock above it, where a pet jumps between the two. */
    climbs: { floor: number; ledge: number }[];
}

/* Where a pet stands and moves, in pixels: `x` its figure's left edge, `y` the bottom of its paint over the layer's bottom. */
export interface RoamSpot {
    x: number;
    y: number;
    facing: 1 | -1;
    walking: boolean;
}

/* The figure as it stands on the ground: its width, its height without the bubble, and its feet's middle from its left edge. */
export const FIGURE = { w: 52, h: 36, feet: 20 } as const;

/* Clear of the cell's rounded corners. */
const EDGE = 8;
/* The paint's bottom on the floor, which keeps the outline under its feet in sight. */
export const FLOOR_LEVEL = 4;
// The paint's bottom row is the outline under its feet, which lies on the dock's top edge.
const FEET_ROW = 2;
/* How far the feet stay in from either end of the dock. */
const LEDGE_INSET = 6;
const WALK_STEP = 4;
const HOP_TICKS = 5;
const HOP_ARC = 12;
/* How close another pet comes before one jumps over it, and how high and long that jump is: clear over its head. */
const LEAP_REACH = 36;
const LEAP_TICKS = 6;
const LEAP_ARC = FIGURE.h + 8;
/* How far apart two pets come to rest, so neither stands in the other. */
const ROOM = FIGURE.w;
/* How many places a pet tries for a walk before it rests a while longer instead. */
const GOAL_TRIES = 8;
/* Beats a pet rests between two walks, about three to ten seconds. */
const REST_TICKS = { min: 20, max: 60 } as const;
const LEDGE_CHANCE = 0.3;
/* How far behind the one it follows a kid walks and comes to rest, and how far it walks on a beat: a little more than a pet, so it catches up after a jump. */
const KID_GAP = 24;
const KID_STEP = 6;
/* How far up a row a kid looks for its pet, more than the kids a pet takes along. */
const MAX_ROW = 8;

/* Where pets may stand in a layer this wide, around these obstacles. */
export function groundOf(width: number, obstacles: readonly Obstacle[]): Ground {
    const reach = FLOOR_LEVEL + FIGURE.h;
    const walls = obstacles.filter((obstacle) => obstacle.bottom < reach).sort((a, b) => a.left - b.left);
    const floors: Span[] = [];
    let from = EDGE;
    for (const wall of walls) {
        const to = wall.left - FIGURE.w;
        if (to >= from) {
            floors.push({ left: from, right: to });
        }
        from = Math.max(from, wall.right);
    }
    if (width - EDGE - FIGURE.w >= from) {
        floors.push({ left: from, right: width - EDGE - FIGURE.w });
    }

    const dock = walls.find((wall) => wall.ledge);
    if (dock === undefined) {
        return { floors, ledge: null, climbs: [] };
    }

    const level = dock.top - FEET_ROW;
    // Another box over the dock, a prompt card, leaves no room for a pet to stand there.
    const crowded = obstacles.some(
        (other) => other !== dock && other.left < dock.right && other.right > dock.left && other.top > level && other.bottom < level + FIGURE.h
    );
    const ledge = { left: dock.left + LEDGE_INSET - FIGURE.feet, right: dock.right - LEDGE_INSET - FIGURE.feet, level };
    if (crowded || ledge.right <= ledge.left) {
        return { floors, ledge: null, climbs: [] };
    }

    const climbs = [
        { floor: dock.left - FIGURE.w, ledge: ledge.left },
        { floor: dock.right, ledge: ledge.right }
    ].filter((climb) => floors.some((floor) => near(floor.left, climb.floor) || near(floor.right, climb.floor)));
    return { floors, ledge, climbs };
}

function near(a: number, b: number): boolean {
    return Math.abs(a - b) < 1;
}

function inSpan(span: Span, x: number): boolean {
    return x >= span.left - 0.5 && x <= span.right + 0.5;
}

function clampTo(span: Span, x: number): number {
    return Math.min(span.right, Math.max(span.left, x));
}

type Place = { on: 'floor'; floor: number } | { on: 'ledge' };

type Step = { kind: 'walk'; x: number } | { kind: 'hop'; on: 'floor' | 'ledge'; x: number };

interface Hop {
    from: { x: number; y: number };
    to: { x: number; y: number };
    on: 'floor' | 'ledge';
    tick: number;
    ticks: number;
    arc: number;
}

interface Roamer {
    mood: PetMood;
    on: 'floor' | 'ledge';
    x: number;
    facing: 1 | -1;
    route: Step[];

    /* Where its route ends, so another does not pick the same place to rest. */
    goal: { on: 'floor' | 'ledge'; x: number } | null;
    hop: Hop | null;
    restLeft: number;
    placed: boolean;

    /* For a kid, the pet or the kid ahead of it in its row that it walks behind; null for a pet. */
    leader: string | null;

    /* Whether a kid moved on this beat: it plans again on every beat while it trails, so its route alone does not say. */
    stepped: boolean;
}

/* Whether it walks or jumps on this beat, or is about to. */
function moving(roamer: Roamer): boolean {
    return roamer.hop !== null || roamer.route.length > 0 || roamer.stepped;
}

/* Whether a pet in this mood stays where it is: one that waits on you or stopped does not walk off. */
function holds(mood: PetMood): boolean {
    return mood === 'waiting' || mood === 'snoozed' || mood === 'stopped';
}

/*
 * The pets of one canvas along the bottom of its screen. Each rests a while in its own pose, walks
 * somewhere else on the floor or onto the dock, and rests again; one that waits on you or stopped
 * stays put. The kids of a pet's sub-agents walk in a row behind it (`follow`). A step is one beat of
 * the pets' clock, so the walk keeps time with the figure's frames.
 */
export class Roam {
    readonly #roamers = new Map<string, Roamer>();
    readonly #random: () => number;
    #ground: Ground = { floors: [], ledge: null, climbs: [] };

    constructor(random: () => number) {
        this.#random = random;
    }

    join(id: string, mood: PetMood): void {
        const roamer = this.#roamers.get(id);
        if (roamer !== undefined) {
            roamer.mood = mood;
            if (holds(mood)) {
                roamer.route = [];
            }
            return;
        }
        this.#roamers.set(id, {
            mood,
            on: 'floor',
            x: 0,
            facing: 1,
            route: [],
            goal: null,
            hop: null,
            restLeft: 0,
            placed: false,
            leader: null,
            stepped: false
        });
    }

    /* A kid of a sub-agent at work, which walks behind `leader`: its pet, or the kid ahead of it in the row. */
    follow(id: string, leader: string): void {
        const roamer = this.#roamers.get(id);
        if (roamer !== undefined) {
            roamer.leader = leader;
            return;
        }
        this.#roamers.set(id, {
            mood: 'working',
            on: 'floor',
            x: 0,
            facing: 1,
            route: [],
            goal: null,
            hop: null,
            restLeft: 0,
            placed: false,
            leader,
            stepped: false
        });
    }

    leave(id: string): void {
        this.#roamers.delete(id);
    }

    /* Moves every pet one beat on this ground. Still, nothing walks or jumps: a pet only takes its place. */
    step(ground: Ground, still: boolean): void {
        const changed = JSON.stringify(ground) !== JSON.stringify(this.#ground);
        this.#ground = ground;
        this.#placeNewcomers();
        this.#placeKids();
        for (const roamer of this.#roamers.values()) {
            if (changed) {
                roamer.route = [];
            }
            if (still) {
                this.#settle(roamer, true);
                continue;
            }
            this.#move(roamer);
        }
    }

    spot(id: string): RoamSpot | null {
        const roamer = this.#roamers.get(id);
        if (roamer === undefined || !roamer.placed) {
            return null;
        }
        if (roamer.hop !== null) {
            const { from, to, tick, ticks } = roamer.hop;
            const progress = tick / ticks;
            const arc = 4 * roamer.hop.arc * progress * (1 - progress);
            return {
                x: Math.round(from.x + (to.x - from.x) * progress),
                y: Math.round(from.y + (to.y - from.y) * progress + arc),
                facing: roamer.facing,
                walking: true
            };
        }
        return { x: Math.round(roamer.x), y: this.#levelOf(roamer.on), facing: roamer.facing, walking: roamer.route.length > 0 || roamer.stepped };
    }

    #levelOf(on: 'floor' | 'ledge'): number {
        return on === 'ledge' && this.#ground.ledge !== null ? this.#ground.ledge.level : FLOOR_LEVEL;
    }

    /* Spreads pets that just came over the floor, apart from one another, so they do not start in a pile. */
    #placeNewcomers(): void {
        const all = [...this.#roamers.values()].filter((roamer) => roamer.leader === null);
        const newcomers = all.filter((roamer) => !roamer.placed);
        const floors = this.#ground.floors;
        if (newcomers.length === 0 || floors.length === 0) {
            return;
        }
        const total = floors.reduce((sum, floor) => sum + floor.right - floor.left, 0);
        all.forEach((roamer, index) => {
            if (roamer.placed) {
                return;
            }
            let along = (total * (index + 0.5)) / all.length;
            const floor =
                floors.find((each) => {
                    const length = each.right - each.left;
                    if (along <= length) {
                        return true;
                    }
                    along -= length;
                    return false;
                }) ?? floors[floors.length - 1];
            roamer.on = 'floor';
            roamer.x = clampTo(floor, floor.left + along);
            roamer.facing = this.#random() < 0.5 ? -1 : 1;
            roamer.restLeft = this.#restTicks();
            roamer.placed = true;
        });
    }

    /* Puts a kid that just came behind the one it follows, where that one stands now, once it is on the ground. */
    #placeKids(): void {
        for (const kid of this.#roamers.values()) {
            const leader = kid.leader === null ? undefined : this.#roamers.get(kid.leader);
            if (kid.placed || leader === undefined || !leader.placed || leader.hop !== null) {
                continue;
            }
            const place = this.#beside({ on: leader.on, x: leader.x }, -leader.facing, true);
            if (place === null) {
                continue;
            }
            kid.on = place.on;
            kid.x = place.x;
            kid.facing = leader.facing;
            kid.placed = true;
        }
    }

    #restTicks(): number {
        return REST_TICKS.min + Math.floor(this.#random() * (REST_TICKS.max - REST_TICKS.min));
    }

    #placeOf(roamer: Roamer): Place | null {
        if (roamer.on === 'ledge') {
            return this.#ground.ledge !== null && inSpan(this.#ground.ledge, roamer.x) ? { on: 'ledge' } : null;
        }
        const floor = this.#ground.floors.findIndex((span) => inSpan(span, roamer.x));
        return floor === -1 ? null : { on: 'floor', floor };
    }

    /*
     * Brings a pet the ground moved away from back onto it: off a dock that hid or filled up, out of the
     * way of a dock that came back over it. Still, it is put there; otherwise it jumps.
     */
    #settle(roamer: Roamer, still: boolean): boolean {
        if (!roamer.placed || roamer.hop !== null || this.#placeOf(roamer) !== null) {
            return false;
        }
        const ledge = this.#ground.ledge;
        const target: { on: 'floor' | 'ledge'; x: number } | null =
            roamer.on === 'floor' && ledge !== null && inSpan(ledge, roamer.x) ? { on: 'ledge', x: roamer.x } : this.#nearestFloor(roamer.x);
        if (target === null) {
            return false;
        }
        if (still) {
            roamer.on = target.on;
            roamer.x = target.x;
            return true;
        }
        this.#startHop(roamer, target.on, target.x);
        return true;
    }

    #nearestFloor(x: number): { on: 'floor'; x: number } | null {
        let best: number | null = null;
        for (const floor of this.#ground.floors) {
            const candidate = clampTo(floor, x);
            if (best === null || Math.abs(candidate - x) < Math.abs(best - x)) {
                best = candidate;
            }
        }
        return best === null ? null : { on: 'floor', x: best };
    }

    #startHop(roamer: Roamer, on: 'floor' | 'ledge', x: number, leap = false): void {
        roamer.hop = {
            from: { x: roamer.x, y: this.#levelOf(roamer.on) },
            to: { x, y: on === 'ledge' && this.#ground.ledge !== null ? this.#ground.ledge.level : FLOOR_LEVEL },
            on,
            tick: 0,
            ticks: leap ? LEAP_TICKS : HOP_TICKS,
            arc: leap ? LEAP_ARC : HOP_ARC
        };
        if (x !== roamer.x) {
            roamer.facing = x > roamer.x ? 1 : -1;
        }
    }

    #move(roamer: Roamer): void {
        if (roamer.hop !== null) {
            roamer.hop.tick += 1;
            if (roamer.hop.tick >= roamer.hop.ticks) {
                roamer.on = roamer.hop.on;
                roamer.x = roamer.hop.to.x;
                roamer.hop = null;
            }
            return;
        }
        if (this.#settle(roamer, false) || holds(roamer.mood)) {
            return;
        }
        if (roamer.leader !== null) {
            this.#follow(roamer);
            return;
        }
        if (roamer.route.length === 0) {
            // One that came to rest in another, after its walk was cut short, walks off at once.
            if (roamer.restLeft > 0 && !this.#crowded(roamer)) {
                roamer.restLeft -= 1;
                return;
            }
            roamer.route = this.#plan(roamer);
            roamer.restLeft = this.#restTicks();
            if (roamer.route.length === 0) {
                return;
            }
        }
        const next = roamer.route[0];
        if (next.kind === 'hop') {
            roamer.route.shift();
            this.#startHop(roamer, next.on, next.x);
            return;
        }
        const distance = next.x - roamer.x;
        roamer.facing = distance >= 0 ? 1 : -1;
        const leap = this.#leapOver(roamer, Math.abs(distance));
        if (leap !== null) {
            this.#startHop(roamer, roamer.on, leap, true);
            return;
        }
        if (Math.abs(distance) <= WALK_STEP) {
            roamer.x = next.x;
            roamer.route.shift();
            return;
        }
        roamer.x += WALK_STEP * roamer.facing;
    }

    /*
     * A kid trails the one it follows while that one walks, a gap behind where it is now, and takes its
     * place in the row once its pet rests. Where nothing leads there from where it stands, past the
     * minimap say, it jumps over. It is not jumped over and does not keep a pet from resting.
     */
    #follow(kid: Roamer): void {
        kid.stepped = false;
        const leader = kid.leader === null ? undefined : this.#roamers.get(kid.leader);
        if (leader === undefined || !leader.placed) {
            return;
        }
        const target = this.#trail(kid, leader);
        if (target === null || (target.on === kid.on && near(target.x, kid.x))) {
            kid.route = [];
            if (leader.x !== kid.x) {
                kid.facing = leader.x > kid.x ? 1 : -1;
            }
            return;
        }
        kid.route = this.#routeTo(kid, target);
        // A walk it already did, to the foot of the dock say, is left out, so it never stands still on its way.
        while (kid.route[0]?.kind === 'walk' && near(kid.route[0].x, kid.x)) {
            kid.route.shift();
        }
        const next = kid.route[0];
        kid.stepped = true;
        if (next === undefined) {
            this.#startHop(kid, target.on, target.x, true);
            return;
        }
        if (next.kind === 'hop') {
            kid.route.shift();
            this.#startHop(kid, next.on, next.x);
            return;
        }
        const distance = next.x - kid.x;
        kid.facing = distance >= 0 ? 1 : -1;
        kid.x = Math.abs(distance) <= KID_STEP ? next.x : kid.x + KID_STEP * kid.facing;
    }

    /*
     * Where a kid heads now. Once its pet rests, its own place in the row (`#rowPlace`). While the one it
     * follows walks or jumps, a gap behind where it is; on the same ground a kid ahead of it, or closer
     * than the gap, waits for it to pass, so it never walks in front.
     */
    #trail(kid: Roamer, leader: Roamer): { on: 'floor' | 'ledge'; x: number } | null {
        const row = this.#rowPlace(kid);
        if (row !== null) {
            return row;
        }
        const place = { on: leader.on, x: leader.x };
        if (!moving(leader)) {
            return this.#beside(place, kid.x !== leader.x ? Math.sign(kid.x - leader.x) : -leader.facing, true);
        }
        const behind = this.#beside(place, -leader.facing, false);
        if (behind === null || (kid.on === behind.on && (behind.x - kid.x) * leader.facing <= 0)) {
            return null;
        }
        return behind;
    }

    /*
     * Where a kid rests while its pet rests: its place in a row laid out from the pet, a gap apart, on the
     * side its first kid is on. Where the ground ends the row goes on at the pet's other side, so no two
     * stand in one place. Null while the pet walks or jumps.
     */
    #rowPlace(kid: Roamer): { on: 'floor' | 'ledge'; x: number } | null {
        let index = 0;
        let first = kid;
        let pet = kid.leader === null ? undefined : this.#roamers.get(kid.leader);
        while (pet !== undefined && pet.leader !== null && index < MAX_ROW) {
            first = pet;
            index += 1;
            pet = this.#roamers.get(pet.leader);
        }
        if (pet === undefined || pet.leader !== null || moving(pet)) {
            return null;
        }
        const span = pet.on === 'ledge' ? this.#ground.ledge : this.#ground.floors.find((floor) => inSpan(floor, pet.x));
        if (span === null || span === undefined) {
            return null;
        }
        const side = first.x !== pet.x ? Math.sign(first.x - pet.x) : -pet.facing;
        const places: number[] = [];
        for (const way of [side, -side]) {
            for (let step = 1; places.length <= index && inSpan(span, pet.x + way * step * KID_GAP); step++) {
                places.push(pet.x + way * step * KID_GAP);
            }
        }
        return { on: pet.on, x: places[index] ?? clampTo(span, pet.x + side * (index + 1) * KID_GAP) };
    }

    /*
     * A gap from a place to one side, on the same ground. With `turn`, where that ground ends too soon it
     * is the other side instead, if there is more room there.
     */
    #beside(place: { on: 'floor' | 'ledge'; x: number }, side: number, turn: boolean): { on: 'floor' | 'ledge'; x: number } | null {
        const span = place.on === 'ledge' ? this.#ground.ledge : this.#ground.floors.find((floor) => inSpan(floor, place.x));
        if (span === null || span === undefined) {
            return null;
        }
        const behind = clampTo(span, place.x + side * KID_GAP);
        const beyond = clampTo(span, place.x - side * KID_GAP);
        return { on: place.on, x: turn && Math.abs(behind - place.x) < KID_GAP && Math.abs(beyond - place.x) > Math.abs(behind - place.x) ? beyond : behind };
    }

    #routeTo(roamer: Roamer, target: { on: 'floor' | 'ledge'; x: number }): Step[] {
        const place = this.#placeOf(roamer);
        const floor = this.#ground.floors.findIndex((span) => inSpan(span, target.x));
        if (place === null || (target.on === 'floor' && floor === -1)) {
            return [];
        }
        return this.#route(place, target.on === 'ledge' ? { on: 'ledge' } : { on: 'floor', floor }, target.x, roamer.x);
    }

    /*
     * Where a pet lands when another stands just ahead of it on the same ground: right past it, so they
     * pass over one another instead of through. Null when nobody is in the way, when it stops before the
     * one ahead (`togo`), when that one is already in the air (it passes under), or when the landing
     * would be off the end of the ground.
     */
    #leapOver(roamer: Roamer, togo: number): number | null {
        const blocker = [...this.#roamers.values()].find((other) => {
            if (other === roamer || !other.placed || other.leader !== null || other.hop !== null || other.on !== roamer.on) {
                return false;
            }
            const ahead = (other.x - roamer.x) * roamer.facing;
            return ahead > 0 && ahead <= LEAP_REACH && togo > ahead;
        });
        if (blocker === undefined) {
            return null;
        }
        const x = blocker.x + roamer.facing * LEAP_REACH;
        const span = roamer.on === 'ledge' ? this.#ground.ledge : this.#ground.floors.find((floor) => inSpan(floor, roamer.x));
        return span !== null && span !== undefined && inSpan(span, x) ? x : null;
    }

    /* A walk to somewhere it can reach, over the dock when that is the way. */
    #plan(roamer: Roamer): Step[] {
        const place = this.#placeOf(roamer);
        if (place === null) {
            return [];
        }
        const { floors, ledge, climbs } = this.#ground;
        const floorOf = (x: number): number => floors.findIndex((span) => inSpan(span, x));
        const reachable: { on: 'floor' | 'ledge'; span: Span; floor: number }[] = [];
        if (place.on === 'floor') {
            reachable.push({ on: 'floor', span: floors[place.floor], floor: place.floor });
        }
        // The dock links the floor on either side of it, so from either one every stretch it touches is in reach.
        const climbsHere = place.on === 'ledge' || climbs.some((climb) => floorOf(climb.floor) === place.floor);
        if (ledge !== null && climbsHere) {
            reachable.push({ on: 'ledge', span: ledge, floor: -1 });
            for (const climb of climbs) {
                const floor = floorOf(climb.floor);
                if (!reachable.some((each) => each.on === 'floor' && each.floor === floor)) {
                    reachable.push({ on: 'floor', span: floors[floor], floor });
                }
            }
        }
        const ledgeTarget = reachable.find((each) => each.on === 'ledge');
        const floorTargets = reachable.filter((each) => each.on === 'floor');
        const chosen =
            ledgeTarget !== undefined && (floorTargets.length === 0 || this.#random() < LEDGE_CHANCE)
                ? ledgeTarget
                : floorTargets[Math.floor(this.#random() * floorTargets.length)];
        if (chosen === undefined) {
            return [];
        }
        for (let i = 0; i < GOAL_TRIES; i++) {
            const x = chosen.span.left + this.#random() * (chosen.span.right - chosen.span.left);
            if (!this.#free(roamer, chosen.on, x)) {
                continue;
            }
            const route = this.#route(place, chosen.on === 'ledge' ? { on: 'ledge' } : { on: 'floor', floor: chosen.floor }, x, roamer.x);
            roamer.goal = { on: chosen.on, x };
            return route;
        }
        return [];
    }

    /* Where another pet will stand once it rests: the end of its walk or jump, or where it stands now. */
    #restingPlace(roamer: Roamer): { on: 'floor' | 'ledge'; x: number } {
        if (roamer.route.length > 0 && roamer.goal !== null) {
            return roamer.goal;
        }
        if (roamer.hop !== null) {
            return { on: roamer.hop.on, x: roamer.hop.to.x };
        }
        return { on: roamer.on, x: roamer.x };
    }

    #free(roamer: Roamer, on: 'floor' | 'ledge', x: number): boolean {
        return [...this.#roamers.values()].every((other) => {
            if (other === roamer || !other.placed || other.leader !== null) {
                return true;
            }
            const place = this.#restingPlace(other);
            return place.on !== on || Math.abs(place.x - x) >= ROOM;
        });
    }

    /* Whether it rests inside another pet that rests too. */
    #crowded(roamer: Roamer): boolean {
        return [...this.#roamers.values()].some(
            (other) =>
                other !== roamer &&
                other.placed &&
                other.leader === null &&
                other.hop === null &&
                other.route.length === 0 &&
                other.on === roamer.on &&
                Math.abs(other.x - roamer.x) < ROOM
        );
    }

    #route(from: Place, to: Place, x: number, start: number): Step[] {
        const { floors, climbs } = this.#ground;
        const climbFor = (floor: number, near: number): { floor: number; ledge: number } | undefined =>
            climbs
                .filter((climb) => floors.findIndex((span) => inSpan(span, climb.floor)) === floor)
                .sort((a, b) => Math.abs(a.floor - near) - Math.abs(b.floor - near))[0];
        if (from.on === 'floor' && to.on === 'floor' && from.floor === to.floor) {
            return [{ kind: 'walk', x }];
        }
        if (from.on === 'ledge' && to.on === 'ledge') {
            return [{ kind: 'walk', x }];
        }
        if (from.on === 'floor') {
            const up = climbFor(from.floor, start);
            if (up === undefined) {
                return [];
            }
            const rest = to.on === 'ledge' ? [{ kind: 'walk' as const, x }] : this.#route({ on: 'ledge' }, to, x, up.ledge);
            return [{ kind: 'walk', x: up.floor }, { kind: 'hop', on: 'ledge', x: up.ledge }, ...rest];
        }
        if (to.on !== 'floor') {
            return [];
        }
        const down = climbFor(to.floor, x);
        if (down === undefined) {
            return [];
        }
        return [
            { kind: 'walk', x: down.ledge },
            { kind: 'hop', on: 'floor', x: down.floor },
            { kind: 'walk', x }
        ];
    }
}
