import type { BuiltInThemeContribution } from '@/extensions/registry';

/*
 * Every ground a few steps under Dark's, the lowest just short of black. The steps between them shrink
 * with it, so the white edges of Dark's borders carry more of what sets one surface off from another.
 * The text is a shade softer than Dark's, since near white on near black glares. The accent stays the
 * palette's, as with any theme.
 */
const TOKENS = {
    '--bg': '#050506',
    '--surface': '#08080a',
    '--surface-raised': '#0d0d0f',
    '--surface-sunken': '#030304',
    '--surface-hover': '#141418',
    '--surface-active': '#1b1b20',
    '--separator': '#131317',
    '--text': '#e1e1e8',
    '--text-muted': '#8a8a96',
    '--text-faint': '#52525c',
    '--canvas-bg': '#050506',
    '--canvas-dot': '#131317'
};

const THUMBNAIL_SVG = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 100">',
    '<rect width="160" height="100" fill="#050506"/>',
    '<rect width="44" height="100" fill="#08080a"/>',
    '<rect x="44" width="1" height="100" fill="#131317"/>',
    '<rect x="7" y="12" width="30" height="7" rx="3.5" fill="#1b1b20"/>',
    '<rect x="7" y="25" width="22" height="7" rx="3.5" fill="#141418"/>',
    '<rect x="58" y="14" width="88" height="56" rx="6" fill="#0d0d0f" stroke="#ffffff" stroke-opacity="0.07"/>',
    '<rect x="66" y="26" width="48" height="6" rx="3" fill="#8a8a96"/>',
    '<rect x="66" y="38" width="64" height="6" rx="3" fill="#52525c"/>',
    '<rect x="116" y="78" width="30" height="12" rx="6" fill="#3471fe"/>',
    '</svg>'
].join('');

const THUMBNAIL = `data:image/svg+xml,${encodeURIComponent(THUMBNAIL_SVG)}`;

export const UMBRA: BuiltInThemeContribution = {
    id: 'ruimte.umbra/umbra',
    extensionId: 'ruimte.umbra',
    theme: { name: 'Umbra', side: 'dark', thumbnail: THUMBNAIL, tokens: TOKENS },
    thumbnailUrl: THUMBNAIL
};
