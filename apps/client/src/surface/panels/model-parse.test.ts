import { describe, expect, spyOn, test } from 'bun:test';
import { Box3, type Mesh, type MeshStandardMaterial } from 'three';
import { strToU8, zipSync } from 'three/examples/jsm/libs/fflate.module.js';
import { parseModel } from './model-parse';
import { countGeometry } from './model-view';

/* A binary STL of one triangle standing up along Z, with an optional per-face color. */
function binaryStl(color?: [number, number, number]): ArrayBuffer {
    const view = new DataView(new ArrayBuffer(84 + 50));
    if (color !== undefined) {
        // The header names a default color, and bit 15 of a face's attribute says it has its own.
        [...'COLOR='].forEach((char, index) => view.setUint8(index, char.charCodeAt(0)));
        [255, 255, 255, 255].forEach((value, index) => view.setUint8(6 + index, value));
    }
    view.setUint32(80, 1, true);
    const vertices = [0, 0, 0, 1, 0, 0, 0, 0, 2];
    vertices.forEach((value, index) => view.setFloat32(84 + 12 + index * 4, value, true));
    if (color !== undefined) {
        const [red, green, blue] = color.map((value) => Math.round(value * 31));
        view.setUint16(84 + 48, red | (green << 5) | (blue << 10), true);
    }
    return view.buffer;
}

const ASCII_STL = `solid part
  facet normal 0 -1 0
    outer loop
      vertex 0 0 0
      vertex 1 0 0
      vertex 0 0 2
    endloop
  endfacet
  facet normal 0 -1 0
    outer loop
      vertex 1 0 0
      vertex 1 0 2
      vertex 0 0 2
    endloop
  endfacet
endsolid part
`;

describe('refusing resources outside a model', () => {
    test('a root USDZ material sends missing textures to refusal and completes an embedded image', async () => {
        const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
        const requested: string[] = [];
        const created: Blob[] = [];
        const revoked: string[] = [];
        const createUrl = URL.createObjectURL.bind(URL);
        const create = spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
            if (!(blob instanceof Blob)) {
                throw new Error('Expected an embedded image blob');
            }
            created.push(blob);
            return createUrl(blob);
        });
        const revoke = spyOn(URL, 'revokeObjectURL').mockImplementation((url) => revoked.push(url));
        // Observe the loader's actual image.src boundary without permitting disk or network I/O.
        class FakeImage {
            listeners = new Map<string, () => void>();
            addEventListener(name: string, listener: () => void): void {
                this.listeners.set(name, listener);
            }
            removeEventListener(name: string): void {
                this.listeners.delete(name);
            }
            set src(url: string) {
                requested.push(url);
                queueMicrotask(() => this.listeners.get(url.startsWith('blob:') ? 'load' : 'error')?.call(this));
            }
        }
        Object.defineProperty(globalThis, 'document', {
            configurable: true,
            value: { createElementNS: () => new FakeImage() }
        });
        const pixel = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (char) =>
            char.charCodeAt(0)
        );
        try {
            for (const path of ['https://example.com/pixel.png', 'file:///etc/pixel.png', '../textures/wood.png', 'texture.png', 'embedded.png']) {
                requested.length = 0;
                const source = `#usda 1.0
def Xform "Root" {
    def Mesh "Triangle" {
        int[] faceVertexCounts = [3]
        int[] faceVertexIndices = [0, 1, 2]
        point3f[] points = [(0, 0, 0), (1, 0, 0), (0, 1, 0)]
        rel material:binding = </Root/Material>
    }
    def Material "Material" {
        token outputs:surface.connect = </Root/Material/Surface.outputs:surface>
        def Shader "Surface" {
            uniform token info:id = "UsdPreviewSurface"
            color3f inputs:diffuseColor.connect = </Root/Material/Texture.outputs:rgb>
            token outputs:surface
        }
        def Shader "Texture" {
            uniform token info:id = "UsdUVTexture"
            asset inputs:file = @${path}@
            float3 outputs:rgb
        }
    }
}`;
                const files: Record<string, Uint8Array> = { 'root.usda': strToU8(source) };
                if (path === 'embedded.png') {
                    files[path] = pixel;
                }
                const zipped = zipSync(files, { level: 0 });
                const { root } = await parseModel(zipped.buffer as ArrayBuffer, 'model/vnd.usdz+zip', 'Nested roots are refused');
                expect(countGeometry(root)).toEqual({ vertices: 3, triangles: 1 });
                expect(requested).toHaveLength(1);
                if (path === 'embedded.png') {
                    expect(requested[0]).toStartWith('blob:');
                    expect(new Uint8Array(await created[0]!.arrayBuffer())).toEqual(pixel);
                    expect(revoked).toEqual(requested);
                    const mesh = root.getObjectByName('Triangle') as Mesh;
                    expect((mesh.material as MeshStandardMaterial).map?.image).toBeDefined();
                } else {
                    expect(requested).toEqual(['about:invalid']);
                    expect(created).toEqual([]);
                }
            }
        } finally {
            create.mockRestore();
            revoke.mockRestore();
            for (const url of revoked) {
                URL.revokeObjectURL(url);
            }
            if (descriptor) {
                Object.defineProperty(globalThis, 'document', descriptor);
            } else {
                Reflect.deleteProperty(globalThis, 'document');
            }
        }
    });

    test('the glTF loader replaces external buffer references before fetching', async () => {
        const fetch = spyOn(globalThis, 'fetch').mockRejectedValue(new Error('intercepted model request'));
        try {
            for (const uri of ['https://example.com/mesh.bin', 'file:///etc/passwd', 'texture.bin', '../textures/mesh.bin']) {
                fetch.mockClear();
                const model = {
                    asset: { version: '2.0' },
                    scene: 0,
                    scenes: [{ nodes: [0] }],
                    nodes: [{ mesh: 0 }],
                    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
                    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 1] }],
                    bufferViews: [{ buffer: 0, byteLength: 36 }],
                    buffers: [{ uri, byteLength: 36 }]
                };
                const bytes = new TextEncoder().encode(JSON.stringify(model)).buffer as ArrayBuffer;
                await expect(parseModel(bytes, 'model/gltf-binary', '')).rejects.toThrow(`Failed to load buffer "${uri}"`);
                expect(fetch.mock.calls.map(([input]) => (input instanceof Request ? input.url : String(input)))).toEqual(['about:invalid']);
            }
        } finally {
            fetch.mockRestore();
        }
    });

    test('a USDZ root inside a folder is refused before the loader parses it', async () => {
        const name = new TextEncoder().encode('scenes/teapot.usdc');
        const bytes = new Uint8Array(30 + name.length);
        bytes.set([0x50, 0x4b, 0x03, 0x04]);
        bytes[26] = name.length;
        bytes.set(name, 30);
        await expect(parseModel(bytes.buffer, 'model/vnd.usdz+zip', 'Nested roots are refused')).rejects.toThrow('Nested roots are refused');
    });
});

describe('parsing an STL', () => {
    test('reads a binary STL as one mesh and stands its Z axis up', async () => {
        const { root, animations } = await parseModel(binaryStl(), 'model/stl', '');
        expect(countGeometry(root)).toEqual({ vertices: 3, triangles: 1 });
        expect(animations).toEqual([]);
        const box = new Box3().setFromObject(root);
        expect(box.max.y).toBeCloseTo(2);
        expect(box.min.z).toBeCloseTo(0);
    });

    test('reads an ASCII STL the same way', async () => {
        const bytes = new TextEncoder().encode(ASCII_STL).buffer as ArrayBuffer;
        const { root } = await parseModel(bytes, 'model/stl', '');
        expect(countGeometry(root)).toEqual({ vertices: 6, triangles: 2 });
        expect(new Box3().setFromObject(root).max.y).toBeCloseTo(2);
    });

    test('gives a plain STL one neutral material and keeps the colors of a colored one', async () => {
        const plain = (await parseModel(binaryStl(), 'model/stl', '')).root as Mesh;
        expect((plain.material as MeshStandardMaterial).vertexColors).toBe(false);
        const colored = (await parseModel(binaryStl([1, 0, 0]), 'model/stl', '')).root as Mesh;
        expect((colored.material as MeshStandardMaterial).vertexColors).toBe(true);
        expect(colored.geometry.getAttribute('color')).toBeDefined();
    });
});
