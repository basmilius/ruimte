import { create } from 'zustand';

/*
 * The extension theme a person picked, by its key, or null for Ruimte's own. Apart from the theme code so
 * the settings read it without loading extensions: a theme from an extension sets its own colors, so the
 * palette stays at its default under it.
 */
export const useExtensionTheme = create<{ key: string | null }>(() => ({ key: null }));
