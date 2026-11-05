import { DoubleSide, LoadingManager, Mesh, MeshStandardMaterial, type AnimationClip, type BufferGeometry, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { USDLoader } from 'three/examples/jsm/loaders/USDLoader.js';
import { firstZipEntry, isEmbeddedUrl } from '@/surface/panels/model-view';

// Fails at once without a request, for every reference a file makes to something outside itself.
const REFUSED_URL = 'about:invalid';

// STL carries no material, so every part gets the same matte gray.
const STL_COLOR = 0xb4b8bf;

interface ParsedModel {
    root: Object3D;
    animations: AnimationClip[];
}

function refusingManager(): LoadingManager {
    const manager = new LoadingManager();
    manager.setURLModifier((url) => (isEmbeddedUrl(url) ? url : REFUSED_URL));
    return manager;
}

async function parseGlb(bytes: ArrayBuffer): Promise<ParsedModel> {
    const gltf = await new GLTFLoader(refusingManager()).parseAsync(bytes, '');
    return { root: gltf.scene, animations: gltf.animations };
}

/*
 * The USD loader looks a texture the package lacks up as a URL relative to the root layer's folder,
 * past the loading manager, so a package with its root in a folder could make the page fetch an address.
 */
function parseUsdz(bytes: ArrayBuffer, nestedRoot: string): Promise<ParsedModel> {
    if (firstZipEntry(new Uint8Array(bytes))?.includes('/') === true) {
        return Promise.reject(new Error(nestedRoot));
    }
    return new Promise((resolve, reject) => {
        try {
            new USDLoader(refusingManager()).parse(bytes, '', (group) => resolve({ root: group, animations: group.animations }), reject);
        } catch (e) {
            reject(e);
        }
    });
}

/*
 * A printer and the tools that make for it put Z up, where the viewer has Y up, so the part turns
 * to stand on the grid the way a slicer shows it. Per-face colors of a binary file are kept.
 */
function parseStl(bytes: ArrayBuffer): ParsedModel {
    const geometry = new STLLoader().parse(bytes) as BufferGeometry & { hasColors?: boolean };
    geometry.rotateX(-Math.PI / 2);
    const colored = geometry.hasColors === true;
    const material = new MeshStandardMaterial({
        color: colored ? 0xffffff : STL_COLOR,
        vertexColors: colored,
        roughness: 0.6,
        metalness: 0,
        // Exported meshes often wind some faces the wrong way, which would leave holes from one side.
        side: DoubleSide
    });
    return { root: new Mesh(geometry, material), animations: [] };
}

/*
 * The scene in the bytes of a model of one of the `FS_MODEL_MIMES`, apart from any viewer, so a
 * caller with bytes from elsewhere draws the same thing. `nestedRoot` is the words for a USDZ this refuses.
 */
export async function parseModel(bytes: ArrayBuffer, mime: string, nestedRoot: string): Promise<ParsedModel> {
    if (mime === 'model/vnd.usdz+zip') {
        return parseUsdz(bytes, nestedRoot);
    }
    if (mime === 'model/stl') {
        return parseStl(bytes);
    }
    return parseGlb(bytes);
}
