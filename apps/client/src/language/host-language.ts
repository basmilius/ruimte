import type { EditorLanguage } from '@adecore/editor-react';
import type { Transport } from '@/transport/transport';

export type HostLanguage = Pick<EditorLanguage, 'editor' | 'uri' | 'languageId' | 'popups' | 'onDispose'> & {
    project: Pick<EditorLanguage['project'], 'folder' | 'service' | 'readText'> & { transport: Transport };
    hover: Pick<EditorLanguage['hover'], 'showRange' | 'keep'>;
    diagnostics: Pick<EditorLanguage['diagnostics'], 'problems'>;
};
