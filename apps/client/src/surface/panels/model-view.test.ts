import { describe, expect, test } from 'bun:test';
import { BoxGeometry, BufferAttribute, BufferGeometry, Group, InstancedMesh, Mesh, MeshBasicMaterial, Points } from 'three';
import { countGeometry, firstZipEntry, fitCamera, gridCellSize, isEmbeddedUrl, type CameraFit } from './model-view';

function distanceOf(fit: CameraFit): number {
    return Math.hypot(fit.position[0] - fit.target[0], fit.position[1] - fit.target[1], fit.position[2] - fit.target[2]);
}

/* The local file header of a zip's first entry, with nothing but its name filled in. */
function zipEntry(name: string): Uint8Array {
    const nameBytes = new TextEncoder().encode(name);
    const header = new Uint8Array(30 + nameBytes.length);
    header.set([0x50, 0x4b, 0x03, 0x04]);
    header[26] = nameBytes.length;
    header.set(nameBytes, 30);
    return header;
}

describe('fitting the camera to a model', () => {
    test('aims at the center of the bounds and stands outside the sphere around them', () => {
        const fit = fitCamera({ min: [-1, 0, -3], max: [3, 2, 1] }, 45, 1);
        expect(fit.target).toEqual([1, 1, -1]);
        const radius = Math.hypot(4, 2, 4) / 2;
        expect(distanceOf(fit)).toBeGreaterThan(radius / Math.sin(Math.PI / 8));
        expect(fit.near).toBeLessThan(distanceOf(fit) - radius);
        expect(fit.far).toBeGreaterThan(distanceOf(fit) + radius);
    });

    test('scales with the model, so a model in millimeters and one in meters look the same', () => {
        const small = fitCamera({ min: [0, 0, 0], max: [0.07, 0.07, 0.07] }, 45, 1.5);
        const large = fitCamera({ min: [0, 0, 0], max: [70, 70, 70] }, 45, 1.5);
        expect(distanceOf(large) / distanceOf(small)).toBeCloseTo(1000);
    });

    test('backs away further in a narrow view, where the width is what the model has to fit', () => {
        const bounds = { min: [-1, -1, -1], max: [1, 1, 1] } as const;
        expect(distanceOf(fitCamera(bounds, 45, 0.5))).toBeGreaterThan(distanceOf(fitCamera(bounds, 45, 1)));
        expect(distanceOf(fitCamera(bounds, 45, 2))).toBeCloseTo(distanceOf(fitCamera(bounds, 45, 1)));
    });

    test('frames a unit sphere when there is nothing to measure, and never divides by a zero aspect', () => {
        const empty = fitCamera(null, 45, 0);
        expect(empty.target).toEqual([0, 0, 0]);
        expect(Number.isFinite(distanceOf(empty))).toBe(true);
        const point = fitCamera({ min: [5, 5, 5], max: [5, 5, 5] }, 45, 1);
        expect(point.target).toEqual([5, 5, 5]);
        expect(distanceOf(point)).toBeCloseTo(distanceOf(empty));
    });
});

describe('counting what a model draws', () => {
    test('counts vertices as stored and triangles by the index, across nested meshes and instances', () => {
        const material = new MeshBasicMaterial();
        const root = new Group();
        const nested = new Group();
        // A box keeps its corners per face: 24 vertices for 12 triangles.
        nested.add(new Mesh(new BoxGeometry(), material));
        root.add(nested);
        const loose = new BufferGeometry();
        loose.setAttribute('position', new BufferAttribute(new Float32Array(9 * 3), 3));
        root.add(new Mesh(loose, material));
        root.add(new InstancedMesh(new BoxGeometry(), material, 3));
        root.add(new Points(loose));
        expect(countGeometry(root)).toEqual({ vertices: 24 + 9 + 72, triangles: 12 + 3 + 36 });
    });

    test('a model without meshes counts nothing', () => {
        expect(countGeometry(new Group())).toEqual({ vertices: 0, triangles: 0 });
    });
});

describe('what a model loader may open', () => {
    test('only the bytes a file carries, never a path beside it or an address', () => {
        expect(isEmbeddedUrl('blob:app://ruimte/0b8f')).toBe(true);
        expect(isEmbeddedUrl('data:image/png;base64,AAAA')).toBe(true);
        expect(isEmbeddedUrl('texture.png')).toBe(false);
        expect(isEmbeddedUrl('../textures/wood.jpg')).toBe(false);
        expect(isEmbeddedUrl('https://example.com/pixel.png')).toBe(false);
        expect(isEmbeddedUrl('file:///etc/passwd')).toBe(false);
    });

    test('reads the name of the first entry of a zip, the root layer of a USDZ', () => {
        expect(firstZipEntry(zipEntry('teapot.usdc'))).toBe('teapot.usdc');
        expect(firstZipEntry(zipEntry('scenes/teapot.usdc'))).toBe('scenes/teapot.usdc');
        expect(firstZipEntry(zipEntry('teapot.usdc').subarray(0, 32))).toBeNull();
        expect(firstZipEntry(new TextEncoder().encode('#usda 1.0\n'.repeat(4)))).toBeNull();
    });
});

describe('the grid under a model', () => {
    test('spaces its cells a power of ten apart, a few across the model', () => {
        expect(gridCellSize({ min: [-1, 0, -1], max: [1, 2, 1] })).toBeCloseTo(0.1);
        expect(gridCellSize({ min: [0, 0, 0], max: [70, 70, 70] })).toBe(10);
        expect(gridCellSize({ min: [0, 0, 0], max: [0.07, 0.07, 0.07] })).toBeCloseTo(0.01);
    });

    test('falls back to the unit sphere for bounds without size', () => {
        expect(gridCellSize(null)).toBeCloseTo(0.1);
        expect(gridCellSize({ min: [1, 1, 1], max: [1, 1, 1] })).toBeCloseTo(0.1);
    });
});
