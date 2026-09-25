import { add, lerp, noise, point, rotate, TAU, type Scene, type Vec3 } from './space.ts';

export const gravity: Scene = (paint, time, pointer) => {
    const turn = time * 0.055;
    const warp = (radius: number, angle: number) => {
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;
        const distance = Math.hypot(x - pointer.x * 90, z - pointer.y * 90);
        const depth = 185 * Math.exp((-distance * distance) / 17000);
        const ripple = Math.sin(radius * 0.035 - time * 0.9) * 5;
        return rotate(point(x, 50 + depth + ripple, z), 0.47, turn, -0.13);
    };

    paint.glow(point(0, 10, 60), 200, 0.14, 0, false);
    for (let ring = 0; ring < 30; ring++) {
        const radius = 32 + ring * 9;
        const opacity = 0.2 + Math.sin((ring / 30) * Math.PI) * 0.42;
        for (let arc = 0; arc < 8; arc++) {
            const path = Array.from({ length: 17 }, (_, i) => warp(radius, ((arc + i / 16) / 8) * TAU));
            paint.line(path, opacity, ring % 5 === 0 ? 1.5 : 0.75, ring % 5 === 0 ? 0.22 : 0);
        }
    }
    for (let spoke = 0; spoke < 40; spoke++) {
        const path = Array.from({ length: 36 }, (_, i) => warp(32 + i * 7.5, (spoke / 40) * TAU));
        paint.line(path, 0.18, 0.7);
    }

    const core = rotate(point(pointer.x * 24, -68 + Math.sin(time * 0.7) * 12, pointer.y * 24), 0.2, 0, -0.13);
    paint.glow(core, 130, 0.24, 0.5, false);
    paint.crystal(core, 39, time * 0.23, 1.6, 0.24);
    for (let i = 0; i < 9; i++) {
        const progress = (time * 0.1 + i / 9) % 1;
        const angle = i * 2.4 + time * 0.12;
        const path = Array.from({ length: 16 }, (_, j) => {
            const t = Math.max(0, progress - j * 0.004);
            return warp(280 - t * 240, angle + t * 1.3);
        });
        paint.line(path, 0.7, 1.4, 0.7);
        paint.glow(path[0]!, 13, 0.9);
    }
};

type Branch = { from: Vec3; to: Vec3; level: number; seed: number };

function growBranches(): Branch[] {
    const branches: Branch[] = [];
    function grow(from: Vec3, direction: Vec3, length: number, level: number, seed: number) {
        const to = add(from, point(direction.x * length, direction.y * length, direction.z * length));
        branches.push({ from, to, level, seed });
        if (level === 5) {
            return;
        }
        const count = level < 2 ? 3 : 2;
        for (let i = 0; i < count; i++) {
            const angle = seed * 2.4 + (i / count) * TAU;
            const spread = 0.6 + level * 0.06;
            const next = point(direction.x * 0.6 + Math.cos(angle) * spread, -0.65 - noise(seed + i) * 0.2, direction.z * 0.6 + Math.sin(angle) * spread);
            const norm = Math.hypot(next.x, next.y, next.z);
            grow(to, point(next.x / norm, next.y / norm, next.z / norm), length * 0.74, level + 1, seed * 3 + i + 1);
        }
    }
    grow(point(0, 205, 0), point(0, -1, 0), 117, 0, 1);
    return branches;
}

const branches = growBranches();

export const garden: Scene = (paint, time, pointer) => {
    const transform = (p: Vec3) => {
        const height = (205 - p.y) / 400;
        return rotate(point(p.x + Math.sin(time * 0.65 + p.y * 0.009) * height * 14 + pointer.x * height * 24, p.y - 5, p.z), -0.08, time * 0.08, 0.06);
    };
    paint.glow(point(0, -45, 70), 260, 0.1, 0, false);
    for (let i = 0; i < branches.length; i++) {
        const branch = branches[i]!;
        const path = Array.from({ length: 12 }, (_, j) => {
            const t = j / 11;
            const p = lerp(branch.from, branch.to, t);
            p.x += Math.sin(t * Math.PI) * Math.sin(branch.seed) * 7;
            p.z += Math.sin(t * Math.PI) * 9;
            return transform(p);
        });
        paint.line(path, 0.5 + branch.level * 0.055, Math.max(0.7, 4 - branch.level * 0.65), 0.13 + branch.level * 0.06);
        const phase = (time * 0.22 - branch.level * 0.14 + 10) % 1;
        if (phase < 0.55) {
            paint.glow(transform(lerp(branch.from, branch.to, phase / 0.55)), 10 - branch.level * 0.65, 0.9, 0.8);
        }
        const end = transform(branch.to);
        if (branch.level >= 4) {
            paint.crystal(end, branch.level === 5 ? 3 + noise(i) * 3 : 7, time * 0.18 + branch.seed, 1.2, 0.35);
        } else {
            paint.glow(end, 18, 0.7, 0.7);
        }
    }
    for (let ring = 0; ring < 3; ring++) {
        const path = Array.from({ length: 97 }, (_, i) =>
            transform(point(Math.cos((i / 96) * TAU) * (45 + ring * 22), 205 + ring * 4, Math.sin((i / 96) * TAU) * (45 + ring * 22)))
        );
        paint.line(path, 0.3 - ring * 0.07, 0.8, 0.2);
    }
};

export const warp: Scene = (paint, time, pointer) => {
    const tunnelCenter = point(pointer.x * 80, pointer.y * 55, 0);
    paint.glow(add(tunnelCenter, point(0, 0, 500)), 110, 0.35, 0.4, false);
    for (let gate = 0; gate < 23; gate++) {
        const progress = (gate / 23 + time * 0.034) % 1;
        const z = 1250 - progress * 1710;
        const twist = (1 - progress) * 1.9 + Math.sin(time * 0.12) * 0.2;
        const radius = 174;
        const center = point(tunnelCenter.x * (1 - progress), tunnelCenter.y * (1 - progress), z);
        const opacity = Math.min(1, progress * 5, (1 - progress) * 10);
        const at = (angle: number, depth = 0) => add(rotate(point(Math.cos(angle) * radius, Math.sin(angle) * radius, depth), 0.08, 0.13, twist), center);
        for (let side = 0; side < 6; side++) {
            const angle = (side / 6) * TAU;
            const next = ((side + 1) / 6) * TAU;
            paint.face([at(angle), at(next), at(next, 10), at(angle, 10)], 0.15, opacity * 0.65);
            paint.line([at(angle), at(next)], opacity * 0.85, gate % 4 === 0 ? 2.8 : 1.1, gate % 4 === 0 ? 0.58 : 0.12);
        }
        if (gate % 3 === 0) {
            paint.glow(at(time * 0.15 + gate), 9, opacity, 0.7);
        }
    }
    for (let i = 0; i < 90; i++) {
        const progress = (noise(i + 6) + time * (0.06 + noise(i + 30) * 0.05)) % 1;
        const angle = noise(i + 150) * TAU;
        const radius = 185 + noise(i + 99) * 95;
        const z = 1100 - progress * 1500;
        const p = point(Math.cos(angle) * radius, Math.sin(angle) * radius, z);
        const opacity = Math.sin(progress * Math.PI) * 0.5;
        paint.line([p, add(p, point(0, 0, 20 + progress * 40))], opacity, 0.85, 0.45);
    }
};
