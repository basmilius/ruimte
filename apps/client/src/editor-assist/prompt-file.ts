import { fileUriToPath } from '@adecore/lsp';
import { isPathBelow, relativeTo } from '@ruimte/contracts';

/* A file as a model is told it: against the project folder, or its whole path outside it. */
export function promptFileName(folder: string, uri: string): string {
    const path = fileUriToPath(uri) ?? uri;
    return isPathBelow(folder, path) ? relativeTo(folder, path) : path;
}
