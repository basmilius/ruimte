import { shortcut, type Shortcut } from '@adecore/ui';
import { chordOf, resolveKeymap, type KeymapId } from '@adecore/editor/keymap';
import { isApplePlatform } from '@/desktop/bridge';

export const RUIMTE_EDITOR_KEYMAP = resolveKeymap({
    expandSelection: {
        other: 'Alt+ArrowUp',
        takenOther: {
            platform: 'Ctrl+W',
            by: 'Close cell'
        }
    },
    matchBrace: {
        other: 'Ctrl+M',
        takenOther: {
            platform: 'Ctrl+Shift+M',
            by: 'Voice control'
        }
    },
    selectionToChat: {
        mac: 'Mod+Alt+K',
        other: 'Mod+Alt+K'
    },
    inlineEdit: {
        mac: 'Mod+I',
        other: 'Mod+I'
    },
    suggestInline: {
        mac: 'Alt+\\',
        other: 'Alt+\\'
    },
    acceptGhostWord: {
        mac: 'Alt+]',
        other: 'Alt+]'
    },
    goToDefinition: {
        mac: 'Alt+Shift+D',
        other: 'Alt+Shift+D',
        takenMac: {
            platform: 'Mod+B',
            by: 'Toggle sidebar'
        },
        takenOther: {
            platform: 'Ctrl+B',
            by: 'Toggle sidebar'
        }
    },
    goToImplementation: {
        mac: 'Alt+Shift+I',
        other: 'Alt+Shift+I',
        takenMac: {
            platform: 'Mod+Alt+B',
            by: 'Toggle panel'
        },
        takenOther: {
            platform: 'Ctrl+Alt+B',
            by: 'Toggle panel'
        }
    },
    peekDefinition: {
        other: 'Alt+Shift+P',
        takenOther: {
            platform: 'Ctrl+Shift+I',
            by: 'Developer tools'
        }
    },
    historyBack: {
        other: 'Mod+[',
        takenOther: {
            platform: 'Ctrl+Alt+ArrowLeft',
            by: 'Focus the cell on the left'
        }
    },
    historyForward: {
        other: 'Mod+]',
        takenOther: {
            platform: 'Ctrl+Alt+ArrowRight',
            by: 'Focus the cell on the right'
        }
    },
    nextProblem: {
        mac: 'Alt+F2',
        other: 'Alt+F2',
        takenMac: {
            platform: 'F2',
            by: 'Every shortcut needs a modifier'
        },
        takenOther: {
            platform: 'F2',
            by: 'Every shortcut needs a modifier'
        }
    }
});

/*
 * The key of an editor or language command on a platform, from the one table the editor binds its keys
 * with (`@adecore/editor/keymap`). A menu, the palette and a handler read it here, so what is printed
 * is what answers. Undefined where the platform has no key for it.
 */
export function shortcutFor(id: KeymapId, apple: boolean): Shortcut | undefined {
    const chord = chordOf(id, apple, RUIMTE_EDITOR_KEYMAP);
    return chord === null ? undefined : shortcut(chord);
}

/* The key on this platform. */
export function editorShortcut(id: KeymapId): Shortcut | undefined {
    return shortcutFor(id, isApplePlatform());
}

/* For the commands that have a key on every platform. */
export function requiredShortcut(id: KeymapId): Shortcut {
    const found = editorShortcut(id);
    if (found === undefined) {
        throw new Error(`The editor key "${id}" has no chord on this platform`);
    }
    return found;
}
