import type { EditorLanguage } from '@adecore/editor-react';
import { fileUriToPath } from '@adecore/lsp';
import { isPathBelow, relativeTo } from '@/shell/panels/files-tree';
import type { Transport } from '@/transport-api/transport';

export type HostLanguage = Pick<EditorLanguage, 'editor' | 'uri' | 'languageId' | 'popups' | 'onDispose' | 'served'> & {
    project: Pick<EditorLanguage['project'], 'folder' | 'service' | 'readText'> & { transport: Transport };
    hover: Pick<EditorLanguage['hover'], 'showRange' | 'keep'>;
    diagnostics: Pick<EditorLanguage['diagnostics'], 'problems'>;
};

/* A file as a model is told it: against the project folder, or its whole path outside it. */
export function promptFileName(folder: string, uri: string): string {
    const path = fileUriToPath(uri) ?? uri;
    return isPathBelow(folder, path) ? relativeTo(folder, path) : path;
}
