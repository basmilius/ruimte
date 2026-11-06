import { isModelMime, sniffModelMime } from '@ruimte/contracts';

/*
 * The model type of an attachment's bytes, or null for bytes that are none. A blob URL of a direct
 * connection carries no type of its own, so the bytes decide unless the response named a model type.
 */
export function modelMimeOf(bytes: Uint8Array, claimed: string): string | null {
    return isModelMime(claimed) ? claimed : sniffModelMime(bytes);
}
