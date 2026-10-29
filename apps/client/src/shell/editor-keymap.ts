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
    shrinkSelection: {
        other: 'Alt+ArrowDown'
    },
    completeCurrentStatement: {
        mac: 'Mod+Alt+Shift+Enter',
        other: 'Mod+Alt+Shift+Enter',
        takenMac: {
            platform: 'Mod+Shift+Enter',
            by: 'Maximize cell'
        },
        takenOther: {
            platform: 'Mod+Shift+Enter',
            by: 'Maximize cell'
        }
    },
    // Off macOS the IntelliJ keys for the next method are Alt with the arrows, which expand and shrink the selection here.
    methodUp: {
        other: 'Ctrl+ArrowUp'
    },
    methodDown: {
        other: 'Ctrl+ArrowDown'
    },
    // Only a diff answers it, where Method Down has no file to step through, so off macOS it shares Ctrl+Down with it instead of IntelliJ's F4.
    jumpToSource: {
        other: 'Ctrl+ArrowDown'
    },
    // Off macOS the IntelliJ keys for the code block are Ctrl with a bracket, which History Back and Previous View hold in Ruimte.
    codeBlockStart: {
        mac: 'Ctrl+Alt+[',
        other: 'Alt+Shift+[',
        takenMac: {
            platform: 'Mod+Alt+[',
            by: 'Camera back'
        }
    },
    codeBlockEnd: {
        mac: 'Ctrl+Alt+]',
        other: 'Alt+Shift+]',
        takenMac: {
            platform: 'Mod+Alt+]',
            by: 'Camera forward'
        }
    },
    codeBlockStartWithSelection: {
        other: 'Ctrl+Alt+Shift+['
    },
    codeBlockEndWithSelection: {
        other: 'Ctrl+Alt+Shift+]'
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
    // Mod with `.` and `,` folds and opens the settings, and Mod with Shift raises and lowers a composer's effort.
    increaseFontSize: {
        mac: 'Ctrl+Shift+.',
        other: 'Alt+Shift+.'
    },
    decreaseFontSize: {
        mac: 'Ctrl+Shift+,',
        other: 'Alt+Shift+,'
    },
    resetFontSize: {
        mac: 'Ctrl+Shift+0',
        other: 'Alt+Shift+0'
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
