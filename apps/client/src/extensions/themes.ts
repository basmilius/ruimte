import { ExtensionThemeSchema, extensionThemeCssProblem, type ExtensionTheme } from '@ruimte/contracts';
import type { InstalledClientExtension } from '@ruimte/desktop-bridge';
import { z } from 'zod';
import { useContributions } from '@/extensions/registry';
import { useExtensionTheme } from '@/state/extension-theme';
import { previewColors } from '@/state/settings';
import { storedJson } from '@/state/stored-json';
import { useTheme } from '@/state/theme';
import { IS_STATION } from '@/station';

const STORAGE_KEY = 'ruimte.extensionTheme';
const TOKENS_ID = 'ruimte-extension-theme';
const CSS_ID = 'ruimte-extension-theme-css';
const PALETTE_ID = 'ruimte-palette';

export interface ThemeChoice {
    // The extension's id and the path in its manifest.
    key: string;
    extensionId: string;
    path: string;
    name: string;
    theme: ExtensionTheme;
    cssUrl: string | null;
    thumbnailUrl: string;
}

const StoredThemeSchema = z.object({ key: z.string(), tokens: z.string(), cssUrl: z.string().nullable() });
type StoredTheme = z.infer<typeof StoredThemeSchema>;

const storedTheme = storedJson<StoredTheme>(STORAGE_KEY, StoredThemeSchema);

function tokensCss(theme: ExtensionTheme): string {
    const lines = Object.entries(theme.tokens).map(([token, value]) => `${token}: ${value};`);

    // Named twice to outweigh the base wherever its stylesheet lands, as the palette does; the palette comes later and stays on top.
    return `[data-theme='${theme.side}'][data-theme] { ${lines.join(' ')} }`;
}

/* Ahead of the palette's stylesheet, so a person's own accent and tint stay over a theme. */
function place(element: HTMLElement): void {
    const palette = document.getElementById(PALETTE_ID);

    if (palette === null) {
        document.head.append(element);
    } else {
        document.head.insertBefore(element, palette);
    }
}

function paint(stored: StoredTheme | null): void {
    // Before the colors, so the palette that follows sees whether a theme of an extension is on.
    useExtensionTheme.setState({ key: stored?.key ?? null });
    previewColors(null);
    document.getElementById(TOKENS_ID)?.remove();
    document.getElementById(CSS_ID)?.remove();

    if (stored === null) {
        return;
    }

    const style = document.createElement('style');

    style.id = TOKENS_ID;
    style.textContent = stored.tokens;
    place(style);

    if (stored.cssUrl !== null) {
        // A link rather than inline text, so a `url()` in it resolves inside the extension's own folder.
        const link = document.createElement('link');

        link.id = CSS_ID;
        link.rel = 'stylesheet';
        link.href = stored.cssUrl;
        place(link);
    }
}

/* Before the first render, so the first pixel is already the chosen theme. Safe mode starts without one. */
export function applyStoredExtensionTheme(): void {
    if (!new URLSearchParams(window.location.search).has('safe-mode')) {
        paint(storedTheme.read());
    }
}

export function activeExtensionTheme(): string | null {
    return storedTheme.read()?.key ?? null;
}

async function loadTheme(extension: InstalledClientExtension, path: string): Promise<ThemeChoice> {
    const response = await fetch(`${extension.base}${path}`);
    const theme = ExtensionThemeSchema.parse(await response.json());
    let cssUrl: string | null = null;

    if (theme.css !== undefined) {
        const url = `${extension.base}${theme.css}`;
        const problem = extensionThemeCssProblem(await (await fetch(url)).text());

        if (problem !== null) {
            throw new Error(`${theme.css}: ${problem}`);
        }

        cssUrl = url;
    }

    return {
        key: `${extension.manifest.id}/${path}`,
        extensionId: extension.manifest.id,
        path,
        name: theme.name,
        theme,
        cssUrl,
        thumbnailUrl: `${extension.base}${theme.thumbnail}`
    };
}

function builtInThemes(): ThemeChoice[] {
    return useContributions.getState().builtInThemes.map((contribution) => ({
        key: contribution.id,
        extensionId: contribution.extensionId,
        path: contribution.id.slice(contribution.extensionId.length + 1),
        name: contribution.theme.name,
        theme: contribution.theme,
        cssUrl: null,
        thumbnailUrl: contribution.thumbnailUrl
    }));
}

function isBuiltIn(extensionId: string): boolean {
    return useContributions.getState().builtIns.some((builtIn) => builtIn.id === extensionId);
}

function extensionIdOf(key: string): string {
    return key.slice(0, key.indexOf('/'));
}

/* Every theme of what is on, the built-ins' first. One that does not load is left out, and the others stay. */
export async function listExtensionThemes(installed: readonly InstalledClientExtension[]): Promise<ThemeChoice[]> {
    const paths = installed
        .filter((extension) => extension.enabled)
        .flatMap((extension) => (extension.manifest.themes ?? []).map((path) => ({ extension, path })));
    const loaded = await Promise.allSettled(paths.map(({ extension, path }) => loadTheme(extension, path)));

    return [...builtInThemes(), ...loaded.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))];
}

export function chooseExtensionTheme(choice: ThemeChoice | null): void {
    if (choice === null) {
        storedTheme.remove();
        paint(null);

        return;
    }

    const stored: StoredTheme = { key: choice.key, tokens: tokensCss(choice.theme), cssUrl: choice.cssUrl };

    storedTheme.write(stored);
    paint(stored);
    useTheme.getState().setTheme(choice.theme.side);
}

/*
 * After an update the theme's files sit elsewhere. One that is off, failed to load or is not on this
 * machine stops painting and stays chosen, so it comes back with its extension; only a removal from
 * this computer forgets it. A Station's list is the machine's, so there nothing is removed for good.
 */
export async function refreshExtensionTheme(installed: readonly InstalledClientExtension[]): Promise<void> {
    const stored = storedTheme.read();

    if (stored === null) {
        return;
    }

    const choice = (await listExtensionThemes(installed)).find((each) => each.key === stored.key);

    if (choice === undefined) {
        const extensionId = extensionIdOf(stored.key);
        // A built-in is never removed, only turned off.
        const removed = !IS_STATION && !isBuiltIn(extensionId) && !installed.some((extension) => extension.manifest.id === extensionId);

        if (removed) {
            chooseExtensionTheme(null);
        } else {
            paint(null);
        }

        return;
    }

    const next: StoredTheme = { key: choice.key, tokens: tokensCss(choice.theme), cssUrl: choice.cssUrl };

    storedTheme.write(next);
    paint(next);
}

/*
 * A built-in turned off takes its theme out of the page and keeps it chosen; turned on again, it paints
 * it anew. The list of installed extensions has no say in it, so it may not have come in yet.
 */
useContributions.subscribe((state, previous) => {
    const stored = storedTheme.read();

    if (state.builtInThemes === previous.builtInThemes || stored === null || !isBuiltIn(extensionIdOf(stored.key))) {
        return;
    }

    const choice = builtInThemes().find((each) => each.key === stored.key);

    if (choice === undefined) {
        paint(null);

        return;
    }

    // Written again, so tokens a new Ruimte changed show from its first start.
    const next: StoredTheme = { key: choice.key, tokens: tokensCss(choice.theme), cssUrl: null };

    storedTheme.write(next);
    paint(next);
});
