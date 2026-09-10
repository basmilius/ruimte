import { createFileTreeIconResolver, getBuiltInSpriteSheet, type FileTreeBuiltInIconSet, type FileTreeIconConfig } from '@pierre/trees';

/* The set the Files tree draws with, and the only one the library colors: `minimal` has no file
   types at all and `standard` drops the brand marks (TypeScript, Vue, Bun, Docker) that make a row
   readable at a glance. Everything outside the tree resolves against the same set, so a tab, a
   picker row and a tree row never disagree about what a file is. */
const ICON_SET: FileTreeBuiltInIconSet = 'complete';

const SPRITE_ELEMENT_ID = 'ruimte-file-icon-sprite';

/* The tree resolves and colors its own icons inside its shadow root, so it takes the set as
   configuration where everything drawn beside it calls `fileIconFor`. */
export const FILE_TREE_ICONS: FileTreeIconConfig = { set: ICON_SET, colored: true };

/* The set gives every file type a hue. The library keeps that mapping in the CSS of the tree's
   shadow root, which nothing outside the tree can read, so it is repeated here against the
   `--file-icon-*` tokens in `styles.css`, which carry the library's own values. A token missing
   here is one the library leaves uncolored; it inherits the muted text color the tree gives it. */
export type FileIconHue = 'blue' | 'cyan' | 'gray' | 'green' | 'indigo' | 'mauve' | 'orange' | 'pink' | 'purple' | 'red' | 'teal' | 'vermilion' | 'yellow';

const HUE_BY_TOKEN: Record<string, FileIconHue> = {
    astro: 'purple',
    babel: 'yellow',
    bash: 'green',
    biome: 'blue',
    bootstrap: 'indigo',
    browserslist: 'yellow',
    bun: 'mauve',
    c: 'blue',
    claude: 'orange',
    cpp: 'blue',
    css: 'indigo',
    database: 'purple',
    default: 'gray',
    docker: 'blue',
    eslint: 'indigo',
    git: 'vermilion',
    go: 'cyan',
    graphql: 'pink',
    html: 'orange',
    image: 'pink',
    javascript: 'yellow',
    json: 'orange',
    markdown: 'green',
    mcp: 'teal',
    npm: 'red',
    oxc: 'cyan',
    postcss: 'red',
    prettier: 'teal',
    python: 'blue',
    react: 'cyan',
    ruby: 'red',
    rust: 'orange',
    sass: 'pink',
    svelte: 'red',
    svg: 'orange',
    svgo: 'green',
    swift: 'orange',
    table: 'teal',
    tailwind: 'cyan',
    terraform: 'indigo',
    text: 'gray',
    typescript: 'blue',
    vite: 'purple',
    vscode: 'blue',
    vue: 'green',
    wasm: 'indigo',
    webpack: 'blue',
    yml: 'red',
    zig: 'orange',
    zip: 'orange'
};

const { resolveIcon } = createFileTreeIconResolver(ICON_SET);

export interface FileIcon {
    /* The id of a `<symbol>` in the sprite `mountFileIconSprite` puts in the document. */
    symbol: string;
    /* Undefined for a type the set leaves uncolored, which then reads as plain muted text. */
    hue: FileIconHue | undefined;
}

/*
 * The icon the set gives a file. The path may be absolute or relative: only the last segment
 * decides, first by exact name (`package.json`, `.gitignore`), then by the longest extension that
 * matches (`spec.ts` before `ts`). Anything the set does not know falls back to its generic file
 * icon, and so does a directory, because the set ships none: the tree marks a folder with the
 * chevron that turns as it opens, not with a glyph of its own.
 */
export const fileIconFor = (path: string): FileIcon => {
    const icon = resolveIcon('file-tree-icon-file', path);
    return { symbol: icon.name, hue: icon.token === undefined ? undefined : HUE_BY_TOKEN[icon.token] };
};

/* The tree carries the sprite into its own shadow root, out of reach of anything that draws an
   icon next to it, so the document gets a copy of the same sheet to point `<use>` at. */
export const mountFileIconSprite = (): void => {
    if (document.getElementById(SPRITE_ELEMENT_ID) !== null) {
        return;
    }
    const holder = document.createElement('div');
    holder.innerHTML = getBuiltInSpriteSheet(ICON_SET);
    const sprite = holder.firstElementChild;
    if (sprite === null) {
        return;
    }
    sprite.id = SPRITE_ELEMENT_ID;
    (document.body ?? document.documentElement).append(sprite);
};
