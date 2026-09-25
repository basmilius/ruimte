import { add, lerp, lighting, noise, point, rotate, TAU, type Pointer, type Space, type Vec3 } from './space.ts';

export type SculptureId = 'singularity' | 'silk' | 'bloom';
export type Surface = { at: (u: number, v: number) => Vec3; length: number; width: number; pearl: number };
export type Spark = { at: Vec3; size: number; strength: number };
export type Sculpture = { surfaces: Surface[]; sparks: Spark[]; threads: Vec3[][] };

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const ease = (value: number) => {
    const t = clamp(value);
    return t * t * t * (t * (t * 6 - 15) + 10);
};

function envelope(time: number, duration: number, offset = 0): number {
    const phase = (((time / duration + offset) % 1) + 1) % 1;
    return ease((phase - 0.12) / 0.27) * (1 - ease((phase - 0.65) / 0.27));
}

function normalize(p: Vec3): Vec3 {
    const length = Math.hypot(p.x, p.y, p.z) || 1;
    return point(p.x / length, p.y / length, p.z / length);
}

function cross(a: Vec3, b: Vec3): Vec3 {
    return point(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
}

function subtract(a: Vec3, b: Vec3): Vec3 {
    return point(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function surfaceNormal(at: Surface['at'], u: number, v: number): Vec3 {
    const du = subtract(at(u + 0.0005, v), at(u - 0.0005, v));
    const dv = subtract(at(u, v + 0.0005), at(u, v - 0.0005));
    return normalize(cross(du, dv));
}

function ribbonAround(curve: (u: number) => Vec3, u: number, v: number, width: number, twist: number): Vec3 {
    const center = curve(u);
    const tangent = normalize(subtract(curve(u + 0.0005), curve(u - 0.0005)));
    const radial = normalize(point(center.x, center.y, center.z * 0.2));
    const binormal = normalize(cross(tangent, radial));
    const normal = normalize(cross(binormal, tangent));
    const c = Math.cos(twist) * v * width;
    const s = Math.sin(twist) * v * width;
    return add(center, point(normal.x * c + binormal.x * s, normal.y * c + binormal.y * s, normal.z * c + binormal.z * s));
}

function addOrbit(sculpture: Sculpture, time: number, radius: number, tilt: number, strength: number): void {
    const orbit = (t: number) => rotate(point(Math.cos(t) * radius, Math.sin(t) * radius, 0), tilt, 0.2, -0.3);
    for (let i = 0; i < 36; i++) {
        const angle = noise(i + 57) * TAU + time * (0.05 + noise(i) * 0.03);
        const p = orbit(angle);
        const scale = 1 + noise(i + 21) * 0.15;
        sculpture.sparks.push({ at: point(p.x * scale, p.y * scale, p.z * scale), size: 3 + noise(i + 8) * 5, strength: strength * (0.3 + noise(i) * 0.7) });
    }
    for (let i = 0; i < 3; i++) {
        sculpture.threads.push(Array.from({ length: 30 }, (_, j) => orbit(time * 0.17 + (i * TAU) / 3 - j * 0.009)));
    }
}

export function singularity(time: number, pointer: Pointer): Sculpture {
    const sculpture: Sculpture = { surfaces: [], sparks: [], threads: [] };
    const breathe = envelope(time, 18);
    const flex = breathe * 0.8 + pointer.active * 0.18;
    const turn = (time * TAU) / 54;
    const orient = (p: Vec3) => rotate(p, -0.24 + Math.sin((time * TAU) / 36) * 0.18, -0.25 + Math.sin(turn) * 0.35, -0.35 + turn * 0.24);
    const curve = (u: number) => {
        const theta = u * TAU;
        const radius = 154 + Math.cos(theta * 3 - time * 0.18) * flex * 19;
        return point(Math.cos(theta) * radius, Math.sin(theta) * radius * (0.92 + flex * 0.1), Math.sin(theta * 2 + time * 0.14) * (18 + flex * 56));
    };
    sculpture.surfaces.push({
        at: (u, v) => {
            const twist = u * Math.PI + (time * TAU) / 28 + Math.sin(u * TAU * 2 - time * 0.24) * flex * 0.55 + pointer.y * 0.35;
            const p = ribbonAround(curve, u, v, 48 + breathe * 12, twist);
            p.z += pointer.x * Math.sin(u * TAU) * 35;
            return orient(p);
        },
        length: 192,
        width: 12,
        pearl: 0.06
    });
    for (let ribbon = 0; ribbon < 2; ribbon++) {
        sculpture.surfaces.push({
            at: (u, v) => {
                const theta = u * TAU + ribbon * Math.PI;
                const radius = 69 + breathe * 17;
                const p = point(Math.cos(theta) * (radius + v * 6), Math.sin(theta) * (radius + v * 6), Math.sin(theta * 2 + time * 0.22 + ribbon) * 36);
                return orient(rotate(p, 0.9 + ribbon, time * -0.11, ribbon));
            },
            length: 112,
            width: 3,
            pearl: 0.6
        });
    }
    sculpture.sparks.push({ at: point(0, 0, 0), size: 63, strength: 0.8 });
    for (let i = 0; i < 12; i++) {
        const phase = (time * 0.035 + i / 12) % 1;
        const angle = i * 2.4 + phase * TAU * 1.4;
        const radius = 32 + phase * 75;
        sculpture.sparks.push({
            at: orient(point(Math.cos(angle) * radius, Math.sin(angle) * radius, Math.sin(angle) * 48)),
            size: 7,
            strength: Math.sin(phase * Math.PI) * 0.7
        });
    }
    addOrbit(sculpture, time, 255, 0.7, 0.42);
    return sculpture;
}

export function silk(time: number, pointer: Pointer): Sculpture {
    const sculpture: Sculpture = { surfaces: [], sparks: [], threads: [] };
    const open = envelope(time, 22);
    const turn = (time * TAU) / 60;
    const orient = (p: Vec3) => rotate(p, -0.2 + open * 0.34, -0.3 + Math.sin(turn) * 0.32, -0.34 + Math.sin(time * 0.12) * 0.1);
    for (let strand = 0; strand < 3; strand++) {
        const phase = (strand * TAU) / 3;
        const curve = (u: number) => {
            const theta = u * TAU;
            const knot = point(
                (126 + 42 * Math.cos(theta * 3 + phase)) * Math.cos(theta * 2),
                (126 + 42 * Math.cos(theta * 3 + phase)) * Math.sin(theta * 2),
                62 * Math.sin(theta * 3 + phase)
            );
            const ring = rotate(point(Math.cos(theta) * 181, Math.sin(theta) * 181, 0), phase + 0.4, phase * 0.4, phase * 0.2);
            return lerp(knot, ring, open * 0.85 + pointer.active * 0.1);
        };
        const at = (u: number, v: number) => {
            const twist = u * TAU * 2 + phase + time * 0.16;
            const width = 12 + (1 - open) * 8 + Math.sin(u * TAU * 3 + phase) * 3;
            const p = ribbonAround(curve, u, v, width, twist);
            p.x += pointer.x * Math.sin(u * TAU + phase) * 18;
            p.y += pointer.y * Math.cos(u * TAU + phase) * 18;
            return orient(p);
        };
        sculpture.surfaces.push({ at, length: 224, width: 6, pearl: strand === 1 ? 0.65 : 0.03 });
        for (let i = 0; i < 4; i++) {
            const u = (time * 0.035 + i / 4 + strand / 12) % 1;
            sculpture.sparks.push({ at: at(u, 0.9), size: 10, strength: 0.65 });
        }
    }
    addOrbit(sculpture, -time * 0.7, 252, -0.4, 0.3);
    return sculpture;
}

export function bloom(time: number, pointer: Pointer): Sculpture {
    const sculpture: Sculpture = { surfaces: [], sparks: [], threads: [] };
    const turn = (time * TAU) / 76;
    const orient = (p: Vec3) => rotate(p, -0.18 + Math.sin(time * 0.08) * 0.12, -0.3, turn);
    const opening = envelope(time, 20);
    for (let petal = 0; petal < 9; petal++) {
        const angle = (petal * TAU) / 9;
        const open = Math.min(1.12, envelope(time, 20, -petal * 0.009) + pointer.active * 0.16);
        const at = (u: number, v: number) => {
            const t = Math.max(0.00001, Math.min(0.99999, u));
            const radius = 40 + t * (88 + open * 97);
            const theta = angle + t * (0.65 + (1 - open) * 1.5) + Math.sin(t * Math.PI) * 0.12;
            const width = Math.pow(Math.sin(t * Math.PI), 0.7) * (34 + open * 9);
            const curl = t * Math.PI * (0.45 + (1 - open) * 1.35) + v * 0.23;
            const offset = v * width;
            const p = point(
                Math.cos(theta) * radius - Math.sin(theta) * offset * Math.cos(curl),
                Math.sin(theta) * radius + Math.cos(theta) * offset * Math.cos(curl),
                -38 + Math.sin(t * Math.PI * (1.15 + open * 0.3)) * (92 - open * 62) + offset * Math.sin(curl)
            );
            p.z += pointer.x * Math.cos(angle) * t * 25 + pointer.y * Math.sin(angle) * t * 25;
            return orient(p);
        };
        sculpture.surfaces.push({ at, length: 76, width: 8, pearl: petal % 3 === 1 ? 0.38 : 0.02 });
        const phase = (time * 0.07 - petal * 0.045 + 10) % 1;
        sculpture.sparks.push({ at: at(phase, 0.9), size: 9, strength: Math.sin(phase * Math.PI) * 0.6 });
    }
    for (let ring = 0; ring < 2; ring++) {
        sculpture.surfaces.push({
            at: (u, v) => {
                const angle = u * TAU;
                const radius = 26 + ring * 10 + v * 3;
                return orient(rotate(point(Math.cos(angle) * radius, Math.sin(angle) * radius, 0), ring * 0.9 + 0.3, time * 0.2, 0));
            },
            length: 72,
            width: 2,
            pearl: 0.75
        });
    }
    sculpture.sparks.push({ at: point(0, 0, 10), size: 80 + opening * 30, strength: 0.7 });
    addOrbit(sculpture, time, 254, 0.18, 0.25 + opening * 0.2);
    return sculpture;
}

export const SCULPTURES = { singularity, silk, bloom };

export function isSculpture(id: string): id is SculptureId {
    return id in SCULPTURES;
}

export function paintSculptureFallback(paint: Space, sculpture: Sculpture): void {
    for (const surface of sculpture.surfaces) {
        const segments = Math.ceil(surface.length * 0.55);
        const bands = Math.min(6, surface.width);
        const mesh = Array.from({ length: segments + 1 }, (_, segment) =>
            Array.from({ length: bands + 1 }, (_, band) => {
                const u = segment / segments;
                const v = (band / bands) * 2 - 1;
                const p = surface.at(u, v);
                const light = lighting(p, surface.at(u + 0.001, v), surface.at(u, v + 0.001), surface.pearl * 0.3);
                return { p, light };
            })
        );
        for (let u = 0; u < segments; u++) {
            for (let v = 0; v < bands; v++) {
                const face = [mesh[u]![v]!, mesh[u + 1]![v]!, mesh[u + 1]![v + 1]!, mesh[u]![v + 1]!];
                paint.face(
                    face.map((vertex) => vertex.p),
                    0,
                    1,
                    face.map((vertex) => vertex.light)
                );
            }
        }
    }
    for (const spark of sculpture.sparks) {
        paint.glow(spark.at, spark.size * 0.5, spark.strength, 0.7);
    }
    for (const thread of sculpture.threads) {
        paint.line(thread, 0.16, 0.6, 0.3);
    }
}
