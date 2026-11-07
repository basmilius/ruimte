import {
    assetPathOf,
    assetReferences,
    byteLength,
    DESIGN_PAGE_MAX_BYTES,
    framedPagesElement,
    inlineJson,
    isPagePath,
    pageDataUrl,
    pageMentions,
    takeRoom,
    withAssets,
    withFramedPages
} from '@/design/design-page';
import { runtimeAssetsElement, withRuntimeAssets } from '@/design/design-runtime';

/* The files of a design folder by their path inside it. Either read throws when the file cannot be read. */
export type DesignFiles = {
    readPage(path: string): Promise<{ text: string; size: number }>;
    readAsset(path: string): Promise<{ url: string; size: number }>;
};

type Inlining = {
    readonly files: DesignFiles;
    total: number;
    readonly pages: Map<string, Promise<string | null>>;
};

/*
 * One page as a file that stands on its own: the frame writes a page from a string, so every file of the
 * folder it pulls in rides along as its bytes, up to the bounds of a visual. A page it frames rides along
 * standing on its own too, read once however often it is named, and never a page it is framed in itself.
 * A file that cannot be read stays a reference that loads nothing, the way a broken path does in a browser.
 *
 * The bounds hold for what is built, not for what is read: a file or page named in many places is in
 * every one of them, a framed page is in its parent as the address that holds it, and one that does not
 * fit stays the path it was. Reading stops at the same bounds, so a folder is not read past them either.
 */
export async function inlineDesignPage(files: DesignFiles, file: string): Promise<string> {
    const page = await files.readPage(file);
    const inlining: Inlining = { files, total: page.size, pages: new Map() };

    return inlinePage(inlining, file, page.text, [file]);
}

/* What the scripts a page may carry weigh, which a page keeps room for whether it ends up with them or not. */
function scriptsWeight(from: string): number {
    return byteLength(framedPagesElement('{}', from)) + byteLength(runtimeAssetsElement(from));
}

/* What one page adds to the script that frames pages when it names `url` as `path`. */
function framedEntryWeight(path: string, url: string): number {
    return byteLength(inlineJson(path)) + byteLength(inlineJson(url)) + 2;
}

function folderOf(path: string): string {
    const slash = path.lastIndexOf('/');

    return slash === -1 ? '' : path.slice(0, slash);
}

function suffixOf(reference: string): string {
    const cut = reference.search(/[?#]/);

    return cut === -1 ? '' : reference.slice(cut);
}

async function inlinePage(inlining: Inlining, file: string, text: string, chain: readonly string[]): Promise<string> {
    const from = folderOf(file);
    const inline = new Map<string, string>();
    const room = { left: DESIGN_PAGE_MAX_BYTES - byteLength(text) - scriptsWeight(from) };

    for (const reference of assetReferences(text, from)) {
        const path = assetPathOf(reference, from);

        if (path === null) {
            continue;
        }

        if (isPagePath(path)) {
            const url = await pageUrl(inlining, path, chain);

            if (url !== null) {
                inline.set(reference, `${url}${suffixOf(reference)}`);
            }

            continue;
        }

        try {
            const asset = await inlining.files.readAsset(path);

            if (inlining.total + asset.size > DESIGN_PAGE_MAX_BYTES) {
                break;
            }

            inlining.total += asset.size;
            inline.set(reference, asset.url);
        } catch {
            // Left as it is: the frame shows the page without it.
        }
    }

    const named = new Map<string, string>();

    for (const mention of pageMentions(text)) {
        const path = assetPathOf(mention, from);
        const url = path === null ? null : await pageUrl(inlining, path, chain);

        if (path !== null && url !== null) {
            named.set(path, url);
        }
    }

    const withBytes = withAssets(text, inline, room);
    const framed = new Map([...named].filter(([path, url]) => takeRoom(room, framedEntryWeight(path, url))));
    const page = withFramedPages(withBytes, from, framed);

    // A page without a script names no file while it runs, but one that frames pages answers for them.
    return /<script\b/i.test(text) || named.size > 0 ? withRuntimeAssets(page, from) : page;
}

function pageUrl(inlining: Inlining, path: string, chain: readonly string[]): Promise<string | null> {
    if (chain.includes(path)) {
        return Promise.resolve(null);
    }

    let url = inlining.pages.get(path);

    if (url === undefined) {
        url = framedPageUrl(inlining, path, [...chain, path]);
        inlining.pages.set(path, url);
    }

    return url;
}

async function framedPageUrl(inlining: Inlining, path: string, chain: readonly string[]): Promise<string | null> {
    try {
        const page = await inlining.files.readPage(path);

        if (inlining.total + page.size > DESIGN_PAGE_MAX_BYTES) {
            return null;
        }

        inlining.total += page.size;

        return pageDataUrl(await inlinePage(inlining, path, page.text, chain));
    } catch {
        return null;
    }
}

/*
 * What the stage reads for the files a page's script names while it runs: each once however often it is
 * asked, by the page or the pages it frames, and up to the bounds of a visual all together. Null for a
 * file it cannot or may not read, which the page shows as a broken path.
 */
export function runtimeAssets(read: (path: string) => Promise<Blob>): (path: string) => Promise<Blob | null> {
    const asked = new Map<string, Promise<Blob | null>>();
    let total = 0;

    return (path) => {
        let bytes = asked.get(path);

        if (bytes === undefined) {
            bytes = read(path).then(
                (blob) => {
                    if (total + blob.size > DESIGN_PAGE_MAX_BYTES) {
                        return null;
                    }

                    total += blob.size;

                    return blob;
                },
                () => null
            );
            asked.set(path, bytes);
        }

        return bytes;
    };
}
