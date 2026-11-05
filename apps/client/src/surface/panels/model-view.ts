import type { InstancedMesh, Mesh, Object3D } from 'three';

type Vec3 = readonly [number, number, number];

export interface ModelBounds {
    min: Vec3;
    max: Vec3;
}

export interface CameraFit {
    target: Vec3;
    position: Vec3;
    near: number;
    far: number;
}

export interface ModelCounts {
    vertices: number;
    triangles: number;
}

function normalized([x, y, z]: Vec3): Vec3 {
    const length = Math.hypot(x, y, z);
    return [x / length, y / length, z / length];
}

// In front, a little above and to the right, the way a product is photographed.
const VIEW_DIRECTION = normalized([0.6, 0.45, 1]);

// Room around the model, so its outline never touches the edge of the view.
const MARGIN = 1.15;

/* The sphere around the bounds; no bounds, or bounds without size, are a unit sphere around their center. */
export function boundingSphere(bounds: ModelBounds | null): { center: Vec3; radius: number } {
    const { min, max } = bounds ?? { min: [0, 0, 0], max: [0, 0, 0] };
    const halfDiagonal = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2;
    return {
        center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
        radius: halfDiagonal > 0 && Number.isFinite(halfDiagonal) ? halfDiagonal : 1
    };
}

/*
 * Where the camera stands to show the whole model: far enough along `VIEW_DIRECTION` that the bounding
 * sphere fits the narrower of the two fields of view. `verticalFov` is in degrees.
 */
export function fitCamera(bounds: ModelBounds | null, verticalFov: number, aspect: number): CameraFit {
    const sphere = boundingSphere(bounds);
    const center = sphere.center;
    const radius = sphere.radius * MARGIN;
    const halfVertical = (verticalFov * Math.PI) / 360;
    const halfHorizontal = Math.atan(Math.tan(halfVertical) * (aspect > 0 && Number.isFinite(aspect) ? aspect : 1));
    const distance = radius / Math.sin(Math.min(halfVertical, halfHorizontal));
    return {
        target: center,
        position: [center[0] + VIEW_DIRECTION[0] * distance, center[1] + VIEW_DIRECTION[1] * distance, center[2] + VIEW_DIRECTION[2] * distance],
        near: distance / 100,
        far: distance * 100
    };
}

/* What the meshes under `root` draw: vertices as stored, triangles as indexed, each instance counted. */
export function countGeometry(root: Object3D): ModelCounts {
    let vertices = 0;
    let triangles = 0;
    root.traverse((object) => {
        const mesh = object as Mesh;
        if (!mesh.isMesh) {
            return;
        }
        const instances = (mesh as InstancedMesh).isInstancedMesh ? (mesh as InstancedMesh).count : 1;
        const positions = mesh.geometry.getAttribute('position')?.count ?? 0;
        vertices += positions * instances;
        triangles += Math.floor((mesh.geometry.index?.count ?? positions) / 3) * instances;
    });
    return { vertices, triangles };
}

/* What a loader may open: only bytes the file carries itself, never a path beside it or an address. */
export function isEmbeddedUrl(url: string): boolean {
    return /^(blob|data):/i.test(url);
}

/*
 * The name of a zip's first entry, or null when the bytes do not open with one. In a USDZ that is
 * the root layer, and textures it misses are looked up relative to its folder.
 */
export function firstZipEntry(bytes: Uint8Array): string | null {
    if (bytes.length < 30 || bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04) {
        return null;
    }
    const nameLength = bytes[26] | (bytes[27] << 8);
    if (bytes.length < 30 + nameLength) {
        return null;
    }
    return new TextDecoder().decode(bytes.subarray(30, 30 + nameLength));
}

/*
 * The spacing of the grid under a model with bounds `bounds`: a power of ten, about a fifth of the
 * model's half diagonal or less, so a model shows a few cells across in any unit it was made in.
 */
export function gridCellSize(bounds: ModelBounds | null): number {
    return 10 ** Math.floor(Math.log10(boundingSphere(bounds).radius / 5));
}
