/*
 * What Monaco draws around the tokens, from the semantic tokens of the client's `styles.css`, so the
 * editor sits on the same ground as the file viewer (`.file-code`) and the terminal, and its widgets
 * (suggestions, hovers, parameter hints) read as the app's own popups. Shiki's theme keeps whatever is
 * not listed here, its bracket colors among them.
 */
const CHROME_TOKENS: Readonly<Record<string, string>> = {
    'editor.background': '--term-bg',
    'editor.foreground': '--term-fg',
    'editorGutter.background': '--term-bg',
    'editorLineNumber.foreground': '--text-faint',
    'editorLineNumber.activeForeground': '--text-muted',
    'editorCursor.foreground': '--term-cursor',
    'editor.selectionBackground': '--selection',
    'editor.lineHighlightBackground': '--surface-hover',
    'editorError.foreground': '--status-error',
    'editorWarning.foreground': '--status-needs-you',
    'editorOverviewRuler.findMatchForeground': '--find-current',
    'editorWidget.background': '--surface-raised',
    'editorWidget.foreground': '--text',
    'editorWidget.border': '--border',
    'widget.shadow': '--border',
    'editorSuggestWidget.background': '--surface-raised',
    'editorSuggestWidget.foreground': '--text',
    'editorSuggestWidget.border': '--border',
    'editorSuggestWidget.selectedBackground': '--surface-active',
    'editorSuggestWidget.selectedForeground': '--text',
    'editorSuggestWidget.selectedIconForeground': '--text',
    'editorSuggestWidget.highlightForeground': '--accent',
    'editorSuggestWidget.focusHighlightForeground': '--accent',
    'editorHoverWidget.background': '--surface-raised',
    'editorHoverWidget.foreground': '--text',
    'editorHoverWidget.border': '--border',
    'editorHoverWidget.highlightForeground': '--accent',
    'editorHoverWidget.statusBarBackground': '--surface-sunken',
    'list.hoverBackground': '--surface-hover',
    descriptionForeground: '--text-muted',
    'textLink.foreground': '--accent',
    'textLink.activeForeground': '--accent',
    'textCodeBlock.background': '--surface-sunken'
};

/* The current line is a fill; Monaco's base theme would also draw a box around it. */
const CHROME_FIXED: Readonly<Record<string, string>> = {
    'editor.lineHighlightBorder': '#00000000'
};

export interface EditorFont {
    fontFamily?: string;
    fontSize?: number;
    lineHeight?: number;
}

const hex = (value: number): string => value.toString(16).padStart(2, '0');

/* Monaco parses only hex, and a token can be any CSS color, `color-mix()` included; a pixel is what every one of them ends up as. */
const pixelHex = (context: OffscreenCanvasRenderingContext2D, color: string): string => {
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = color;
    context.fillRect(0, 0, 1, 1);
    const [red = 0, green = 0, blue = 0, alpha = 255] = context.getImageData(0, 0, 1, 1).data;
    return `#${hex(red)}${hex(green)}${hex(blue)}${alpha === 255 ? '' : hex(alpha)}`;
};

/* The chrome colors under an element, for a Monaco theme. A token the page does not define is left to Shiki's theme. */
export const readChromeColors = (element: HTMLElement): Record<string, string> => {
    const context = new OffscreenCanvas(1, 1).getContext('2d', { willReadFrequently: true });
    if (!context) {
        return { ...CHROME_FIXED };
    }
    const defined = getComputedStyle(element);
    // Through `color` rather than the custom property itself, so the value comes back resolved whatever chain of `var()` it sits behind.
    const probe = document.createElement('span');
    probe.style.display = 'none';
    element.append(probe);
    const colors: Record<string, string> = { ...CHROME_FIXED };
    for (const [key, token] of Object.entries(CHROME_TOKENS)) {
        if (defined.getPropertyValue(token).trim() === '') {
            continue;
        }
        probe.style.color = `var(${token})`;
        colors[key] = pixelHex(context, getComputedStyle(probe).color);
    }
    probe.remove();
    return colors;
};

const pixels = (style: CSSStyleDeclaration, token: string): number | undefined => {
    const value = Number.parseFloat(style.getPropertyValue(token));
    return Number.isFinite(value) ? value : undefined;
};

/* The viewer's code face: `--font-mono`, which the terminal font setting overrides, at `--text-code`. */
export const readEditorFont = (element: HTMLElement): EditorFont => {
    const style = getComputedStyle(element);
    const family = style.getPropertyValue('--font-mono').trim();
    return {
        fontFamily: family === '' ? undefined : family,
        fontSize: pixels(style, '--text-code'),
        lineHeight: pixels(style, '--text-code--line-height')
    };
};
