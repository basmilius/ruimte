import type { ArtifactVersion } from '@ruimte/contracts';
import { fileViewOf } from '@/output/file-view';

type SavedPreviewView = 'page' | 'markdown' | 'code' | 'image' | 'pdf';

export interface SavedPreviewOf {
    view: SavedPreviewView;
    file: number;
}

// Past this a file read whole is read only when a person opens it, so a long thread never pulls megabytes.
export const PREVIEW_MAX_BYTES = 256 * 1024;

const INLINE: ReadonlySet<string> = new Set<SavedPreviewView>(['page', 'markdown', 'code', 'image', 'pdf']);

function isInline(view: string): view is SavedPreviewView {
    return INLINE.has(view);
}

/*
 * How the thread draws a version an agent or a routine published, so its reply need not repeat it, or
 * null when it stays a row: the first file there is something to show of, by what the file is. What a
 * person saved from the thread is already in it.
 */
export function savedPreviewOf(version: ArtifactVersion): SavedPreviewOf | null {
    if (version.provenance.maker === 'person') {
        return null;
    }
    for (const [index, file] of version.files.entries()) {
        const view = fileViewOf(file);
        if (!isInline(view)) {
            continue;
        }
        // An image comes as a URL the thread draws lazily; everything else is read whole.
        if (view !== 'image' && file.size > PREVIEW_MAX_BYTES) {
            return null;
        }
        return { view, file: index };
    }
    return null;
}
