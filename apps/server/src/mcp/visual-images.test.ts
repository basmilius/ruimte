import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, stat, symlink, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VISUAL_LIMITS } from '@ruimte/contracts';
import { VISUAL_IMAGE_BYTES, embedLocalImages, findImageReferences, imageType, prepareVisualPage, readAtMost, type ImageFiles } from './visual-images.ts';

function bytesOf(...parts: (string | number[] | Uint8Array)[]): Uint8Array {
    return Buffer.concat(parts.map((part) => (typeof part === 'string' ? Buffer.from(part, 'latin1') : Buffer.from(part))));
}

function uint32(value: number): number[] {
    return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function uint32le(value: number): number[] {
    return uint32(value).reverse();
}

const PNG = bytesOf('\x89PNG\r\n\x1a\n', [0, 0, 0, 13], 'IHDR', new Array(17).fill(0));
const JPEG = bytesOf([0xff, 0xd8, 0xff, 0xe0, 0, 16], 'JFIF', [0]);
const GIF = bytesOf('GIF89a', [1, 0, 1, 0, 0, 0, 0], ';');
const WEBP = bytesOf('RIFF', uint32le(20), 'WEBP', 'VP8L', uint32le(8), new Array(8).fill(0));
const AVIF = bytesOf(uint32(24), 'ftyp', 'avif', uint32(0), 'mif1', 'miaf');
const HEIC = bytesOf(uint32(24), 'ftyp', 'heic', uint32(0), 'mif1', 'heic');
const HEIF = bytesOf(uint32(20), 'ftyp', 'mif1', uint32(0), 'mif1');
const BMP = bytesOf('BM', uint32le(58), uint32le(0), uint32le(54), uint32le(40), new Array(40).fill(0));
const ICO = bytesOf([0, 0, 1, 0, 1, 0], [16, 16, 0, 0, 1, 0, 32, 0], uint32le(4), uint32le(22), [1, 2, 3, 4]);
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>';

function dataUri(type: string, bytes: Uint8Array | string): string {
    return `data:${type};base64,${Buffer.from(bytes).toString('base64')}`;
}

describe('findImageReferences', () => {
    function paths(html: string): string[] {
        return findImageReferences(html).map((reference) => reference.path);
    }

    test('a whole quoted attribute, JS string or template literal is a reference, its extension in any case', () => {
        expect(paths('<img src="/Users/bas/shot.png">')).toEqual(['/Users/bas/shot.png']);
        expect(paths("<img src='/tmp/before.JPG'>")).toEqual(['/tmp/before.JPG']);
        expect(paths('image.src = `/tmp/after.webp`;')).toEqual(['/tmp/after.webp']);
        expect(paths('const shots = ["/tmp/a.jpeg", "/tmp/b.gif", "/tmp/c.avif", "/tmp/d.svg", "/tmp/e.bmp", "/tmp/f.ico"];')).toEqual([
            '/tmp/a.jpeg',
            '/tmp/b.gif',
            '/tmp/c.avif',
            '/tmp/d.svg',
            '/tmp/e.bmp',
            '/tmp/f.ico'
        ]);
        expect(paths('<img alt="it\'s here" src="/tmp/my shot (2).png">')).toEqual(['/tmp/my shot (2).png']);
    });

    test('a CSS url() takes a bare path, with space around it, and a quoted one as a string', () => {
        expect(paths('body { background: url(/tmp/bg.png) }')).toEqual(['/tmp/bg.png']);
        expect(paths('div { background: URL(  /tmp/bg.png  ) }')).toEqual(['/tmp/bg.png']);
        expect(paths(`a { background: url("/tmp/a.png") } b { background: url('/tmp/b.png') }`)).toEqual(['/tmp/a.png', '/tmp/b.png']);
    });

    test('a drive path takes either slash, and a JS string that doubles its backslashes reads as one', () => {
        expect(paths('<img src="C:\\Users\\bas\\shot.png">')).toEqual(['C:\\Users\\bas\\shot.png']);
        expect(paths("img.src = 'C:\\\\Users\\\\bas\\\\shot.png';")).toEqual(['C:\\Users\\bas\\shot.png']);
        expect(paths('<img src="d:/shots/a.png">')).toEqual(['d:/shots/a.png']);
        expect(paths('div { background: url(C:\\shots\\a.png) }')).toEqual(['C:\\shots\\a.png']);
    });

    test('the place of a reference is the path alone, so the quotes stay where they are', () => {
        const html = '<img src="/tmp/a.png"><div style="background:url( /tmp/b.png )"></div>';
        expect(findImageReferences(html).map(({ start, end }) => html.slice(start, end))).toEqual(['/tmp/a.png', '/tmp/b.png']);
    });

    test('addresses, data and blob URLs, relative paths and other files never match', () => {
        for (const html of [
            '<img src="https://example.com/a.png">',
            '<img src="//cdn.example.com/a.png">',
            '<img src="file:///tmp/a.png">',
            '<img src="data:image/png;base64,iVBORw0KGgo=">',
            '<img src="blob:https://example.com/0f6c.png">',
            '<img src="images/a.png">',
            '<img src="./a.png">',
            '<img src="../a.png">',
            '<a href="/tmp/notes.txt">',
            '<img src="/tmp/a.png?v=2">',
            '<img src="/tmp/a.png ">',
            '<img srcset="/tmp/a.png 1x, /tmp/b.png 2x">',
            'img.src = `/tmp/${name}.png`;',
            'img.src = "/tmp/" + "a.png";',
            'background: url(/tmp/a b.png)',
            'background: url(images/a.png)',
            'background: myurl(/tmp/a.png)',
            '<p>See /tmp/a.png for it</p>',
            '<img src="/tmp/a\n.png">',
            '<img src="C:shots\\a.png">'
        ]) {
            expect(paths(html)).toEqual([]);
        }
    });

    test('a path longer than a file system takes is not a reference', () => {
        expect(paths(`"/${'a'.repeat(4091)}.png"`)).toHaveLength(1);
        expect(paths(`"/${'a'.repeat(4092)}.png"`)).toEqual([]);
        expect(paths(`url(/${'a'.repeat(4091)}.png)`)).toHaveLength(1);
        expect(paths(`url(/${'a'.repeat(4092)}.png)`)).toEqual([]);
    });

    // Every pattern here makes a backtracking matcher retry from each position; this one reads each stretch once.
    test('a large page of quotes and url( that never close is read through to the one reference at its end', () => {
        const page = [
            '"/'.repeat(500_000),
            `'/${'a'.repeat(4097)}`.repeat(200),
            'url(/x '.repeat(200_000),
            '`/a${'.repeat(200_000),
            'url(/'.repeat(200_000),
            '<img src="/tmp/end.png">'
        ].join('\n');
        expect(page.length).toBeGreaterThan(5_000_000);
        expect(paths(page)).toEqual(['/tmp/end.png']);
    });
});

describe('imageType', () => {
    test('each format is known by its signature, whatever it is called', () => {
        expect(imageType(PNG)).toBe('image/png');
        expect(imageType(JPEG)).toBe('image/jpeg');
        expect(imageType(GIF)).toBe('image/gif');
        expect(imageType(bytesOf('GIF87a', new Array(7).fill(0)))).toBe('image/gif');
        expect(imageType(WEBP)).toBe('image/webp');
        expect(imageType(AVIF)).toBe('image/avif');
        expect(imageType(HEIC)).toBe('image/heic');
        expect(imageType(HEIF)).toBe('image/heif');
        expect(imageType(BMP)).toBe('image/bmp');
        expect(imageType(ICO)).toBe('image/x-icon');
        expect(imageType(Buffer.from(SVG))).toBe('image/svg+xml');
    });

    test('an SVG is known behind a BOM, a declaration, instructions, comments and a doctype with an internal subset', () => {
        const svg = [
            '\uFEFF<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
            '<!-- Drawn by hand > nothing else -->',
            '<?xml-stylesheet href="style.css"?>',
            '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd" [',
            '    <!ENTITY ns_svg "http://www.w3.org/2000/svg">',
            "    <!ENTITY arrow 'a > b ] c'>",
            '    <!-- ]> an end that is not one -->',
            '    <?note ]> neither ?>',
            ']>',
            '<!-- after the doctype -->',
            '<svg xmlns="&ns_svg;"><title>&arrow;</title></svg>'
        ].join('\n');
        expect(imageType(Buffer.from(svg))).toBe('image/svg+xml');
        expect(imageType(Buffer.from('<svg>'))).toBe('image/svg+xml');
        expect(imageType(Buffer.from('\n  <svg\nviewBox="0 0 1 1"/>'))).toBe('image/svg+xml');
    });

    test('text under an image name, and documents whose root is not svg, are no image', () => {
        for (const text of [
            '',
            'hello, this is not an image\n',
            'BMthis starts like a bitmap and is not one',
            'GIF8',
            'RIFF....WEBPnope',
            '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\n',
            '<html><svg></svg></html>',
            '<svgx/>',
            '<SVG/>',
            '<?xml version="1.0"?><html/>',
            '<?xml version="1.0"?',
            '<!-- <svg> never closes',
            '<!DOCTYPE x [ <!ENTITY a "<svg>"> ]><html/>',
            '<!DOCTYPE svg [ <!ENTITY a "never closed> ]><svg/>',
            '<!DOCTYPE svg [ <!-- ]> --> <svg/>'
        ]) {
            expect(imageType(Buffer.from(text))).toBeNull();
        }
    });

    test('a video or an ISO file without an image brand, a truncated header and a bitmap with a wrong header are no image', () => {
        expect(imageType(bytesOf(uint32(24), 'ftyp', 'isom', uint32(0), 'isom', 'mp41'))).toBeNull();
        expect(imageType(bytesOf(uint32(64), 'ftyp', 'avif', uint32(0)))).toBeNull();
        expect(imageType(PNG.subarray(0, 12))).toBeNull();
        expect(imageType(bytesOf('BM', uint32le(58), uint32le(0), uint32le(54), uint32le(41), new Array(40).fill(0)))).toBeNull();
        expect(imageType(bytesOf([0, 0, 1, 0, 0, 0]))).toBeNull();
        expect(imageType(bytesOf([0xff, 0xd8, 0xff, 0xff]))).toBeNull();
    });
});

describe('embedLocalImages', () => {
    let folder: string;
    let sized: string[];
    let reads: string[];
    let files: ImageFiles;

    beforeEach(async () => {
        folder = await mkdtemp(join(tmpdir(), 'ruimte-visual-images-'));
        sized = [];
        reads = [];
        files = {
            size: async (path) => {
                sized.push(path);
                return (await stat(path)).size;
            },
            read: (path, into) => {
                reads.push(path);
                return readAtMost(path, into);
            }
        };
    });

    afterEach(async () => {
        await rm(folder, { recursive: true, force: true });
    });

    async function file(name: string, bytes: Uint8Array | string): Promise<string> {
        const path = join(folder, name);
        await writeFile(path, bytes);
        return path;
    }

    test('a page without local images comes back as it was, and nothing is read', async () => {
        const html = '<img src="https://example.com/a.png"><img src="data:image/png;base64,AA==">';
        expect(await embedLocalImages(html, { partial: false })).toEqual({ html, problems: [], overflow: null });
    });

    test('each path is read once and every place that names it gets the image, typed by its bytes', async () => {
        const shot = await file('shot.jpg', PNG);
        const icon = await file('icon.svg', SVG);
        const html = `<img src="${shot}"><div style="background:url(${shot})"></div><script>const icon = '${icon}';</script>`;
        const page = await embedLocalImages(html, { partial: false, files });
        const png = dataUri('image/png', PNG);
        expect(page).toEqual({
            html: `<img src="${png}"><div style="background:url(${png})"></div><script>const icon = '${dataUri('image/svg+xml', SVG)}';</script>`,
            problems: [],
            overflow: null
        });
        expect(sized).toEqual([shot, icon]);
        expect(reads).toEqual([shot, icon]);
    });

    test('every format embeds under the type its bytes give', async () => {
        const formats: [string, Uint8Array, string][] = [
            ['a.png', PNG, 'image/png'],
            ['b.jpeg', JPEG, 'image/jpeg'],
            ['c.gif', GIF, 'image/gif'],
            ['d.webp', WEBP, 'image/webp'],
            ['e.avif', AVIF, 'image/avif'],
            ['f.avif', HEIC, 'image/heic'],
            ['g.bmp', BMP, 'image/bmp'],
            ['h.ico', ICO, 'image/x-icon']
        ];
        for (const [name, bytes, type] of formats) {
            const path = await file(name, bytes);
            expect((await embedLocalImages(`"${path}"`, { partial: false })).html).toBe(`"${dataUri(type, bytes)}"`);
        }
    });

    test('a missing file, a folder, text under an image name and a link to it are each named and left as written', async () => {
        const secret = await file('id_ed25519', '-----BEGIN OPENSSH PRIVATE KEY-----\n');
        const renamed = await file('key.png', '-----BEGIN OPENSSH PRIVATE KEY-----\n');
        const linked = join(folder, 'linked.png');
        await symlink(secret, linked);
        const shelf = join(folder, 'shelf.png');
        await mkdir(shelf);
        const gone = join(folder, 'gone.png');
        const shot = await file('shot.png', PNG);
        const html = `"${gone}" "${renamed}" "${linked}" "${shelf}" "${shot}"`;
        const page = await embedLocalImages(html, { partial: true });
        expect(page.html).toBe(`"${gone}" "${renamed}" "${linked}" "${shelf}" "${dataUri('image/png', PNG)}"`);
        const notAnImage = 'its bytes are not a PNG, JPEG, GIF, WebP, AVIF, HEIF, SVG, BMP or ICO image';
        expect(page.problems).toEqual([
            { path: gone, kind: 'missing', reason: 'no image file there' },
            { path: renamed, kind: 'missing', reason: notAnImage },
            { path: linked, kind: 'missing', reason: notAnImage },
            { path: shelf, kind: 'missing', reason: 'no image file there' }
        ]);
    });

    test('a link to an image embeds the image', async () => {
        const shot = await file('shot.png', PNG);
        const linked = join(folder, 'linked.png');
        await symlink(shot, linked);
        expect((await embedLocalImages(`"${linked}"`, { partial: false })).html).toBe(`"${dataUri('image/png', PNG)}"`);
    });

    test('an image past the limit is turned away on its size, before anything reads it', async () => {
        const large = await file('large.png', bytesOf(PNG, new Array(100).fill(0)));
        const page = await embedLocalImages(`"${large}"`, { partial: true, files, imageBytes: 64 });
        expect(page.problems).toMatchObject([{ path: large, kind: 'too-large' }]);
        expect(reads).toEqual([]);
    });

    test('the image limit is 10 MiB, and a file that size and one byte is refused on its size', async () => {
        expect(VISUAL_IMAGE_BYTES).toBe(10 * 1024 * 1024);
        const large = await file('large.png', PNG);
        await truncate(large, VISUAL_IMAGE_BYTES + 1);
        const page = await embedLocalImages(`"${large}"`, { partial: true, files });
        expect(page.problems).toEqual([{ path: large, kind: 'too-large', reason: '10.1 MiB, more than the 10 MiB an image may be' }]);
        expect(reads).toEqual([]);
    });

    test('a file that grew after its size was taken is read one byte past the limit and no further', async () => {
        const grown = await file('grown.png', bytesOf(PNG, new Array(100).fill(0)));
        const into = Buffer.alloc(51);
        expect(await readAtMost(grown, into)).toBe(51);
        const page = await embedLocalImages(`"${grown}"`, { partial: true, imageBytes: 50, files: { ...files, size: async () => 10 } });
        expect(page.problems).toMatchObject([{ path: grown, kind: 'too-large' }]);
        expect(page.problems[0]!.reason).toStartWith('more than the ');
        expect(page.html).toBe(`"${grown}"`);
    });

    test('a whole embed stops before reading anything once the page cannot hold every image', async () => {
        const first = await file('first.png', bytesOf(PNG, new Array(300).fill(0)));
        const second = await file('second.png', bytesOf(PNG, new Array(300).fill(0)));
        const html = `"${first}" "${second}"`;
        const page = await embedLocalImages(html, { partial: false, files, pageBytes: 600 });
        expect(page.overflow).toBeGreaterThan(600);
        expect(page.html).toBe(html);
        expect(reads).toEqual([]);
        expect(sized).toEqual([first, second]);
    });

    test('a partial embed leaves out the image that does not fit and embeds the ones after it that do', async () => {
        const small = await file('small.png', PNG);
        const large = await file('large.png', bytesOf(PNG, new Array(600).fill(0)));
        const last = await file('last.gif', GIF);
        const html = `"${small}" "${large}" "${last}"`;
        const page = await embedLocalImages(html, { partial: true, files, pageBytes: 600 });
        expect(page.html).toBe(`"${dataUri('image/png', PNG)}" "${large}" "${dataUri('image/gif', GIF)}"`);
        expect(page.problems).toMatchObject([{ path: large, kind: 'too-large' }]);
        expect(page.problems[0]!.reason).toStartWith('with it the page would pass the ');
        expect(page.overflow).toBeNull();
        expect(reads).toEqual([small, last]);
    });

    test('the page limit is the daemon page limit, counted in UTF-8 bytes', async () => {
        const shot = await file('shot.png', PNG);
        const uri = dataUri('image/png', PNG);
        const reference = `"${shot}"`;
        const fill = VISUAL_LIMITS.bytes - (reference.length - shot.length) - uri.length;
        const exact = await embedLocalImages(`${'x'.repeat(fill)}${reference}`, { partial: false });
        expect(exact.overflow).toBeNull();
        expect(Buffer.byteLength(exact.html)).toBe(VISUAL_LIMITS.bytes);
        const over = await embedLocalImages(`é${'x'.repeat(fill - 1)}${reference}`, { partial: false });
        expect(over.overflow).toBe(VISUAL_LIMITS.bytes + 1);
    });
});

describe('prepareVisualPage', () => {
    let folder: string;

    beforeEach(async () => {
        folder = await mkdtemp(join(tmpdir(), 'ruimte-visual-page-'));
    });

    afterEach(async () => {
        await rm(folder, { recursive: true, force: true });
    });

    test('the page goes back in the word it came in, as --html=<page> or after --html', async () => {
        const shot = join(folder, 'shot.png');
        await writeFile(shot, PNG);
        const png = dataUri('image/png', PNG);
        expect(await prepareVisualPage('show', ['--title', 'T', `--html=<img src="${shot}">`])).toEqual({
            argv: ['--title', 'T', `--html=<img src="${png}">`],
            lines: []
        });
        expect(await prepareVisualPage('preview', ['--html', `<img src="${shot}">`, '--width', '400'])).toEqual({
            argv: ['--html', `<img src="${png}">`, '--width', '400'],
            lines: []
        });
        expect(await prepareVisualPage('show', ['--title', 'T', '--html'])).toEqual({ argv: ['--title', 'T', '--html'], lines: [] });
    });
});
