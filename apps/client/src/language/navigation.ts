import i18next from 'i18next';
import { StaleResultError, fileUriToPath, type Location, type NavigationResult } from '@ruimte/smart-editor-lsp';
import type { EditorPosition } from '@ruimte/smart-editor';
import { CANVAS_SHORTCUTS } from '@/canvas/shortcuts';
import { basenameOf } from '@/shell/panels/files-tree';
import { useToasts } from '@/state/toasts';
import type { EditorLanguage } from './editor-language';
import { locationsOf } from './hover-content';
import { rangeHolds } from './diagnostics-model';
import { placesOfName } from './symbol-links';
import { isShortcut } from './shortcut-keys';

export type NavigationKind = 'definition' | 'declaration' | 'typeDefinition' | 'implementation';

const METHODS: Record<NavigationKind, string> = {
    definition: 'textDocument/definition',
    declaration: 'textDocument/declaration',
    typeDefinition: 'textDocument/typeDefinition',
    implementation: 'textDocument/implementation'
};

const SHORTCUT_KINDS: readonly [NavigationKind, keyof typeof CANVAS_SHORTCUTS][] = [
    ['definition', 'goToDefinition'],
    ['typeDefinition', 'goToTypeDefinition'],
    ['implementation', 'goToImplementation']
];

const TOAST_ID = 'language-navigation';

function say(key: string, options?: Record<string, unknown>): string {
    return i18next.t(`panels:language.navigation.${key}`, options);
}

/* The places of a result, each once: the two servers of a Vue file may both know the same one. */
export function uniqueLocations(result: NavigationResult): Location[] {
    const seen = new Set<string>();
    return locationsOf(result).filter((location) => {
        const { start } = location.range;
        const key = `${location.uri}\0${start.line}\0${start.character}`;
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

/*
 * Going to where a name is defined, declared, typed or implemented: Mod+click on the name or a shortcut
 * for the caret. One place opens at once, in this file or in the one it lives in, the way a file opens in
 * Ruimte; several are listed under the name to choose from.
 */
export class NavigationFeature {
    private readonly language: EditorLanguage;

    constructor(language: EditorLanguage) {
        this.language = language;
        const { editor } = language;
        const offs = [
            editor.onClick((click) => {
                if (!click.mod || click.alt || click.shift || !this.supports('definition')) {
                    return false;
                }
                void this.go('definition', click.position);
                return true;
            }),
            editor.onKeyDown((event) => {
                const found = SHORTCUT_KINDS.find(([, name]) => isShortcut(CANVAS_SHORTCUTS[name], event));
                if (found === undefined) {
                    return false;
                }
                void this.go(found[0]);
                return true;
            })
        ];
        language.onDispose(() => {
            for (const off of offs) {
                off();
            }
        });
    }

    supports(kind: NavigationKind): boolean {
        return this.language.project.service.supports(METHODS[kind], this.language.uri);
    }

    async go(kind: NavigationKind, position: EditorPosition = this.language.editor.getCaret()): Promise<void> {
        const { project, uri, editor } = this.language;
        if (!this.supports(kind)) {
            this.tell(say('unavailable'));
            return;
        }
        let result: NavigationResult;
        try {
            const { service } = project;
            result = await (kind === 'definition'
                ? service.definition(uri, position)
                : kind === 'declaration'
                  ? service.declaration(uri, position)
                  : kind === 'typeDefinition'
                    ? service.typeDefinition(uri, position)
                    : service.implementation(uri, position));
        } catch (error) {
            if (!(error instanceof StaleResultError)) {
                this.tell(say('failed', { message: error instanceof Error ? error.message : String(error) }));
            }
            return;
        }
        const places = uniqueLocations(result);
        if (places.length === 0) {
            this.tell(say('none'));
        } else if (kind === 'definition' && places.length === 1 && places[0]!.uri === uri && rangeHolds(places[0]!.range, position)) {
            // The name is its own definition, so what a person wants to see is where it is used.
            void this.language.peek.open(position);
        } else if (places.length === 1) {
            this.language.goTo(places[0]!);
        } else {
            this.language.locations(places, position, say(`titles.${kind}`));
        }
        editor.focus();
    }

    /*
     * A name in the signature of a hover, which is a snippet and no document a server can be asked about by position.
     * The symbol the signature declares goes to the definition the hover already knows; any other name is looked
     * up by name among the symbols of the project. One match goes there at once, several are listed, and none says nothing.
     */
    async goToName(name: string, anchor: EditorPosition, own: Location | null): Promise<void> {
        const { project, uri, editor } = this.language;
        if (own !== null) {
            this.language.goTo(own);
            return;
        }
        if (!project.service.supports('workspace/symbol', uri)) {
            return;
        }
        try {
            const places = placesOfName(await project.service.workspaceSymbols(uri, name), name, editor.getText());
            if (places.length === 1) {
                this.language.goTo(places[0]!);
            } else if (places.length > 1) {
                this.language.locations(places, anchor, say('titles.symbol'));
            }
        } catch {
            // A name that cannot be found is a link that does nothing, not an error.
        }
    }

    private tell(title: string): void {
        useToasts.getState().show({ id: TOAST_ID, kind: 'error', title });
    }
}

/* How a place reads in a list: the file and the line, with the folder it is in. */
export function locationRow(location: Location, stored: string | null): { label: string; detail: string; path: true } {
    const path = stored ?? fileUriToPath(location.uri) ?? location.uri;
    const name = basenameOf(path);
    const folder = path.slice(0, Math.max(0, path.length - name.length)).replace(/\/$/, '');
    return { label: `${name}:${location.range.start.line + 1}`, detail: folder, path: true };
}
