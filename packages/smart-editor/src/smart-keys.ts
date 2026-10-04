import type { EditorSmartKeys } from './types.ts';

export const DEFAULT_SMART_KEYS: EditorSmartKeys = {
    autoPairBrackets: true,
    autoPairQuotes: true,
    surroundSelection: true,
    tabOutOfClosers: true,
    smartIndentOnEnter: true,
    indentOnPaste: true,
    smartSemicolon: true,
    camelHumps: false
};

/* The keys with what a host left out filled in from the defaults. */
export function resolveSmartKeys(keys: Partial<EditorSmartKeys> | undefined): EditorSmartKeys {
    return { ...DEFAULT_SMART_KEYS, ...keys };
}
