import { add, lerp, lighting, noise, point, rotate, TAU, type Scene, type Vec3 } from './space.ts';

function flight(index: number, time: number, target: Vec3): Vec3 {
    const group = index % 3;
    const angle = time * (0.26 + noise(index) * 0.12) + index * 2.399;
    const orbit = 120 + noise(index + 9) * 95;
    const converge = (Math.sin(time * 0.3 + group * 2.1) + 1) / 2;
    const p = point(Math.cos(angle) * orbit, Math.sin(angle * 1.3 + group) * 110, Math.sin(angle) * orbit);
    const station = rotate(point(190, -95 + group * 80, 0), 0, (group / 3) * TAU + time * 0.04);
    return add(lerp(p, station, converge * 0.6), target);
}

export const swarm: Scene = (paint, time, pointer) => {
    const target = point(pointer.x * 90, pointer.y * 60, -pointer.active * 30);
    paint.glow(target, 180, 0.13, 0.2, false);
    for (let group = 0; group < 3; group++) {
        const center = add(rotate(point(190, -95 + group * 80, 0), 0, (group / 3) * TAU + time * 0.04), target);
        const ring = Array.from({ length: 65 }, (_, i) =>
            add(rotate(point(Math.cos((i / 64) * TAU) * 31, 0, Math.sin((i / 64) * TAU) * 31), group * 0.6 + 0.5, time * 0.08), center)
        );
        paint.line(ring, 0.65, 1.1, 0.45);
        paint.glow(center, 25, 0.7, 0.7);
        paint.crystal(center, 10, -time * 0.3, 1.4, 0.45);
    }
    for (let i = 0; i < 34; i++) {
        const p = flight(i, time, target);
        const ahead = flight(i, time + 0.03, target);
        const yaw = Math.atan2(ahead.x - p.x, ahead.z - p.z);
        const pitch = -Math.atan2(ahead.y - p.y, Math.hypot(ahead.x - p.x, ahead.z - p.z));
        const size = 6 + noise(i + 5) * 5;
        const body = [
            point(0, 0, size * 2),
            point(-size, 0, -size),
            point(0, -size * 0.6, -size * 0.45),
            point(size, 0, -size),
            point(0, size * 0.35, -size)
        ].map((v) => add(rotate(v, pitch, yaw), p));
        paint.face([body[0]!, body[1]!, body[2]!], 0.25);
        paint.face([body[0]!, body[2]!, body[3]!], 0.42);
        paint.face([body[0]!, body[3]!, body[4]!, body[1]!], -0.12);
        for (let trail = 0; trail < 4; trail++) {
            const path = Array.from({ length: 9 }, (_, j) => flight(i, time - (trail * 8 + j) * 0.055, target));
            paint.line(path, 0.44 - trail * 0.1, 1.5 - trail * 0.2, 0.3);
        }
        paint.glow(p, 9, 0.65, 0.7);
        if (i % 6 === 0) {
            const next = flight((i + 3) % 34, time, target);
            paint.line([p, next], 0.13, 0.6, 0.25);
            paint.glow(lerp(p, next, (time * 0.4 + i * 0.17) % 1), 6, 0.8);
        }
    }
};

export const aurora: Scene = (paint, time, pointer) => {
    const turn = time * 0.085 + pointer.x * 0.23;
    const surface = (u: number, v: number, ribbon: number) => {
        const angle = u * TAU * 0.86 + (ribbon * TAU) / 3 + turn;
        const radius = 130 + Math.sin(u * TAU * 2 + time * 0.42 + ribbon) * 25;
        const width = 36 + Math.sin(u * Math.PI) * 22;
        const twist = u * TAU * 1.5 + time * 0.26 + ribbon + pointer.y * 0.7;
        const offset = v * width;
        const p = point(
            Math.cos(angle) * (radius + offset * Math.cos(twist)),
            (u - 0.5) * 385 + offset * Math.sin(twist),
            Math.sin(angle) * (radius + offset * Math.cos(twist))
        );
        return rotate(p, 0.2, -0.25, -0.48);
    };
    paint.glow(point(0, 0, 70), 240, 0.14, 0, false);
    for (let ribbon = 0; ribbon < 3; ribbon++) {
        const mesh = Array.from({ length: 111 }, (_, segment) =>
            Array.from({ length: 9 }, (_, band) => {
                const u = segment / 110;
                const v = ((band / 8) * 2 - 1) * Math.pow(Math.sin(u * Math.PI), 0.25);
                const p = surface(u, v, ribbon);
                return { p, light: lighting(p, surface(u + 0.001, v, ribbon), surface(u, v + 0.001, ribbon), ribbon === 1 ? 0.18 : -0.08) };
            })
        );
        for (let segment = 0; segment < 110; segment++) {
            for (let band = 0; band < 8; band++) {
                const patch = [mesh[segment]![band]!, mesh[segment + 1]![band]!, mesh[segment + 1]![band + 1]!, mesh[segment]![band + 1]!];
                paint.face(
                    patch.map((vertex) => vertex.p),
                    0,
                    1,
                    patch.map((vertex) => vertex.light)
                );
            }
        }
        for (const edge of [-1, 1]) {
            for (let section = 0; section < 12; section++) {
                const path = Array.from({ length: 11 }, (_, i) => {
                    const u = (section + i / 10) / 12;
                    return surface(u, edge * Math.pow(Math.sin(u * Math.PI), 0.25), ribbon);
                });
                paint.line(path, 0.5, 0.7, 0.68);
            }
        }
        const signal = (time * 0.08 + ribbon / 3) % 1;
        paint.glow(surface(signal, 0, ribbon), 17, 0.7, 0.8);
    }
};

const blockVertices = [
    point(-1, -1, -1),
    point(1, -1, -1),
    point(1, 1, -1),
    point(-1, 1, -1),
    point(-1, -1, 1),
    point(1, -1, 1),
    point(1, 1, 1),
    point(-1, 1, 1)
];
const blockFaces = [
    [0, 1, 2, 3],
    [4, 7, 6, 5],
    [0, 4, 5, 1],
    [3, 2, 6, 7],
    [0, 3, 7, 4],
    [1, 5, 6, 2]
];

export const assembly: Scene = (paint, time, pointer) => {
    const wave = (Math.sin(time * 0.38 - 1.3) + 1) / 2;
    const unfold = wave * wave + pointer.active * 0.23;
    const turn = time * 0.095 + 0.55;
    paint.glow(point(0, 0, 90), 240, 0.16, 0, false);
    for (let layer = 0; layer < 3; layer++) {
        for (let column = 0; column < 3; column++) {
            for (let row = 0; row < 3; row++) {
                const index = layer * 9 + column * 3 + row;
                if (column === 1 && row === 1 && layer === 1) {
                    continue;
                }
                const anchor = point((column - 1) * 66, (row - 1) * 66, (layer - 1) * 66);
                const expansion = 1 + unfold * (0.85 + noise(index) * 0.7);
                const center = point(anchor.x * expansion, anchor.y * expansion, anchor.z * expansion);
                center.y += Math.sin(time * 0.7 + index) * unfold * 8;
                const vertices = blockVertices.map((p) => {
                    const local = rotate(point(p.x * 28, p.y * 28, p.z * 28), unfold * (noise(index) - 0.5) * 0.8, unfold * (noise(index + 4) - 0.5) * 0.8);
                    return rotate(add(local, center), -0.44 + pointer.y * 0.1, turn, 0.18);
                });
                for (const face of blockFaces) {
                    paint.face(
                        face.map((i) => vertices[i]!),
                        layer === 0 && row === 0 ? 0.46 : 0.03
                    );
                }
                const edges = [
                    [0, 1],
                    [1, 2],
                    [2, 3],
                    [3, 0],
                    [4, 5],
                    [5, 6],
                    [6, 7],
                    [7, 4],
                    [0, 4],
                    [1, 5],
                    [2, 6],
                    [3, 7]
                ];
                for (const [a, b] of edges) {
                    paint.line([vertices[a!]!, vertices[b!]!], 0.28, 0.65, 0.7);
                }
                if (unfold > 0.25) {
                    const start = rotate(anchor, -0.44, turn, 0.18);
                    const end = rotate(center, -0.44, turn, 0.18);
                    paint.line([start, end], Math.min(0.3, unfold * 0.25), 0.8, 0.4);
                }
            }
        }
    }
    paint.crystal(point(0, 0, 0), 20, -turn, 1.2, 0.7);
    paint.glow(point(0, 0, 0), 55, 0.5, 0.85);
};
