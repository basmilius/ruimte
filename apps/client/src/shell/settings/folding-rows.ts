import type { CodeFolding } from '@/state/code-folding';

/* One switch of the code folding tab: the setting it writes, and the words under `editor.folding.<group>.<words>`. */
export interface FoldingRow {
    readonly field: keyof CodeFolding;
    readonly words: string;
}

export interface FoldingGroup {
    readonly id: string;
    readonly rows: readonly FoldingRow[];
}

/* Grouped as the platform groups them: what every language has, then what each language adds. */
export const FOLDING_GROUPS: readonly FoldingGroup[] = [
    {
        id: 'general',
        rows: [
            { field: 'fileHeader', words: 'fileHeader' },
            { field: 'imports', words: 'imports' },
            { field: 'docComments', words: 'docComments' },
            { field: 'methodBodies', words: 'methodBodies' },
            { field: 'customRegions', words: 'customRegions' }
        ]
    },
    {
        id: 'script',
        rows: [
            { field: 'scriptObjectLiterals', words: 'objectLiterals' },
            { field: 'scriptArrayLiterals', words: 'arrayLiterals' },
            { field: 'scriptXmlLiterals', words: 'xmlLiterals' }
        ]
    },
    {
        id: 'php',
        rows: [
            { field: 'phpTags', words: 'tags' },
            { field: 'phpHeredocs', words: 'heredocs' },
            { field: 'phpFunctionBodies', words: 'functionBodies' },
            { field: 'phpMethodBodies', words: 'methodBodies' },
            { field: 'phpClassBodies', words: 'classBodies' },
            { field: 'phpAttributes', words: 'attributes' }
        ]
    },
    { id: 'markup', rows: [{ field: 'markupTags', words: 'tags' }] },
    {
        id: 'markdown',
        rows: [
            { field: 'markdownFrontMatter', words: 'frontMatter' },
            { field: 'markdownCodeFences', words: 'codeFences' },
            { field: 'markdownTables', words: 'tables' }
        ]
    }
];
