import { expect, test } from 'bun:test';
import { modelMimeOf } from '@/chat/model-attachment';

function binaryStl(triangles: number): Uint8Array {
    const bytes = new Uint8Array(84 + 50 * triangles);
    new DataView(bytes.buffer).setUint32(80, triangles, true);
    return bytes;
}

const text = (value: string): Uint8Array => new TextEncoder().encode(value);

function usdz(name: string): Uint8Array {
    const bytes = new Uint8Array(30 + name.length);
    bytes.set(text('PK\u0003\u0004'));
    bytes[26] = name.length;
    bytes.set(text(name), 30);
    return bytes;
}

test('a model type the response names is taken as it is', () => {
    expect(modelMimeOf(text('anything'), 'model/stl')).toBe('model/stl');
});

test('a blob without a type of its own is told apart by its bytes', () => {
    const octets = 'application/octet-stream';
    expect(modelMimeOf(text('glTF\u0002\u0000\u0000\u0000'), octets)).toBe('model/gltf-binary');
    expect(modelMimeOf(usdz('scene.usdc'), octets)).toBe('model/vnd.usdz+zip');
    expect(modelMimeOf(binaryStl(3), octets)).toBe('model/stl');
    expect(modelMimeOf(text('  solid part\n facet normal 0 0 1'), octets)).toBe('model/stl');
});

test('bytes of no model are none, an image among them', () => {
    expect(modelMimeOf(text('\u0089PNG\r\n\u001a\n'), 'image/png')).toBeNull();
    expect(modelMimeOf(binaryStl(3).subarray(0, 200), '')).toBeNull();
    expect(modelMimeOf(text('solidarity'), '')).toBeNull();
});
