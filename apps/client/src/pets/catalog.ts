import { FOX_SPRITE, FROG_SPRITE } from '@/pets/animals';
import { CLAUDE_BUDDY, CODEX_BUDDY } from '@/pets/buddies';
import type { DrawnSprite } from '@/pets/pixel';
import { sketchedSprite, type PetPalette } from '@/pets/sketches';

/*
 * Every built-in figure and the packs a person switches on. The buddies and the animals give each
 * provider a figure of its own; any other pack spreads its figures over the nodes. A few figures stand
 * in no pack and are only given to a CLI by hand.
 */

const PALETTES = {
    cream: { outline: '#70695f', body: '#f4f2e8', shade: '#cecbbc', light: '#fffef7', ink: '#48423c', accent: '#e9c9b0' },
    brindle: { outline: '#422e24', body: '#a87948', shade: '#73513a', light: '#c59d67', ink: '#291f1c', accent: '#dfc79c' },
    copper: { outline: '#542b1b', body: '#e9823e', shade: '#c66030', light: '#ffb366', ink: '#231610', accent: '#98dccc' },
    blue: { outline: '#263358', body: '#6e9ce3', shade: '#4b6fac', light: '#aecdfa', ink: '#172744', accent: '#f0d68a' },
    mint: { outline: '#20443e', body: '#74b8a0', shade: '#488d78', light: '#bbdfb8', ink: '#142d2b', accent: '#f5cf91' },
    violet: { outline: '#3b2b58', body: '#9f87cf', shade: '#74619f', light: '#d1c0ee', ink: '#251b3a', accent: '#b8edc0' },
    coal: { outline: '#1f242c', body: '#515765', shade: '#343b48', light: '#8f96a3', ink: '#f4f0d3', accent: '#b9d5ec' },
    honey: { outline: '#564021', body: '#dab45b', shade: '#aa813b', light: '#f4dfa0', ink: '#302a25', accent: '#d9eef1' },
    rose: { outline: '#643849', body: '#d28e9d', shade: '#ae687e', light: '#f3c2c6', ink: '#402a3e', accent: '#c2dfc4' },
    moss: { outline: '#344631', body: '#86a162', shade: '#607f49', light: '#c4d5a1', ink: '#263526', accent: '#e9b38b' },
    terracotta: { outline: '#61382c', body: '#c5825b', shade: '#a15b44', light: '#ebbc87', ink: '#372924', accent: '#ecdec0' },
    aqua: { outline: '#24434d', body: '#6caeb8', shade: '#46818f', light: '#afe0da', ink: '#172f3d', accent: '#e5cfa0' },
    red: { outline: '#5b2d34', body: '#c96e62', shade: '#9c4a4e', light: '#eea77d', ink: '#34202c', accent: '#f1ddba' },
    pebbles: { outline: '#6d665b', body: '#e4dac5', shade: '#b6ad9b', light: '#fff2d7', ink: '#51463f', accent: '#b4c4c7' },
    onyx: { outline: '#343b3e', body: '#858c8c', shade: '#586064', light: '#c1c4bb', ink: '#253239', accent: '#b5ce92' }
} as const satisfies Record<string, PetPalette>;

function sketched(id: string, shape: string, palette: keyof typeof PALETTES): DrawnSprite {
    return sketchedSprite({ id, shape, palette: PALETTES[palette] });
}

/* Each provider's buddy and animal, in the order the settings list them. A CLI not here gets Claude's. */
const PROVIDER_FIGURES = [
    { agent: 'claude', buddy: CLAUDE_BUDDY, animal: FOX_SPRITE },
    { agent: 'codex', buddy: CODEX_BUDDY, animal: FROG_SPRITE },
    { agent: 'antigravity', buddy: sketched('orbit', 'ufo', 'blue'), animal: sketched('hummingbird', 'hummingbird', 'aqua') },
    { agent: 'copilot', buddy: sketched('wing', 'visor', 'blue'), animal: sketched('penguin', 'penguin', 'coal') },
    { agent: 'grok', buddy: sketched('spark', 'cyclops', 'coal'), animal: sketched('raven', 'raven', 'coal') },
    { agent: 'apple', buddy: sketched('pip', 'seedbot', 'cream'), animal: sketched('deer', 'deer', 'terracotta') },
    { agent: 'nanogpt', buddy: sketched('nano', 'nanobot', 'violet'), animal: sketched('nano-bee', 'bee', 'violet') },
    { agent: 'anthropic-claude-api', buddy: sketched('relay', 'relay', 'copper'), animal: sketched('api-fox', 'fox', 'copper') }
] as const;

/* What a pack does with an agent: give its provider's own figure, or spread its figures over the nodes. */
export type PetPackKind = 'provider' | 'spread';

export interface PetPack {
    id: string;
    kind: PetPackKind;
    figures: readonly DrawnSprite[];
}

export const PET_PACKS = [
    { id: 'buddies', kind: 'provider', figures: PROVIDER_FIGURES.map((entry) => entry.buddy) },
    { id: 'animals', kind: 'provider', figures: PROVIDER_FIGURES.map((entry) => entry.animal) },
    { id: 'nox-and-chanel', kind: 'spread', figures: [sketched('nox', 'rabbit', 'cream'), sketched('chanel', 'rabbit', 'brindle')] },
    { id: 'pebbles-and-onyx', kind: 'spread', figures: [sketched('pebbles', 'fluffy-cat', 'pebbles'), sketched('onyx', 'tabby-cat', 'onyx')] },
    {
        id: 'woodland',
        kind: 'spread',
        figures: [
            sketched('hazel', 'squirrel', 'terracotta'),
            sketched('bramble', 'hedgehog', 'brindle'),
            sketched('oak', 'owl', 'honey'),
            sketched('bandit', 'raccoon', 'coal')
        ]
    },
    {
        id: 'living-room',
        kind: 'spread',
        figures: [
            sketched('miso', 'cat', 'terracotta'),
            sketched('pixel', 'dog', 'cream'),
            sketched('mochi', 'hamster', 'honey'),
            sketched('pico', 'parakeet', 'mint')
        ]
    },
    {
        id: 'deep-sea',
        kind: 'spread',
        figures: [
            sketched('inky', 'octopus', 'violet'),
            sketched('lumi', 'axolotl', 'rose'),
            sketched('tuck', 'turtle', 'moss'),
            sketched('ripple', 'ray', 'aqua')
        ]
    },
    {
        id: 'cosmos',
        kind: 'spread',
        figures: [
            sketched('cosmo', 'astronaut', 'cream'),
            sketched('pebble', 'alien', 'mint'),
            sketched('halley', 'comet', 'honey'),
            sketched('rover', 'rover', 'terracotta')
        ]
    },
    {
        id: 'workshop',
        kind: 'spread',
        figures: [
            sketched('bolt', 'robot', 'blue'),
            sketched('rivet', 'beaver', 'brindle'),
            sketched('zip', 'snail', 'terracotta'),
            sketched('clamp', 'crab', 'red')
        ]
    },
    {
        id: 'windowsill',
        kind: 'spread',
        figures: [
            sketched('cap', 'mushroom', 'red'),
            sketched('sprig', 'sprout', 'mint'),
            sketched('prickle', 'cactus', 'moss'),
            sketched('sunny', 'sunflower', 'honey')
        ]
    },
    {
        id: 'after-hours',
        kind: 'spread',
        figures: [
            sketched('echo', 'bat', 'violet'),
            sketched('velvet', 'moth', 'brindle'),
            sketched('glow', 'firefly', 'moss'),
            sketched('soot', 'cat', 'coal')
        ]
    }
] as const satisfies readonly PetPack[];

export type PetPackId = (typeof PET_PACKS)[number]['id'];

/* Figures for providers Ruimte has no CLI for yet, which a person can still give to any CLI. */
export const EXTRA_FIGURES: readonly DrawnSprite[] = [
    sketched('deep', 'whale', 'blue'),
    sketched('gust', 'windbird', 'red'),
    sketched('qiu', 'redpanda', 'terracotta'),
    sketched('luna', 'moonrabbit', 'violet'),
    sketched('llumi', 'llama', 'cream'),
    sketched('duo', 'twinstar', 'blue')
];

const FIGURES: ReadonlyMap<string, DrawnSprite> = new Map(
    [...PET_PACKS.flatMap((pack) => pack.figures as readonly DrawnSprite[]), ...EXTRA_FIGURES].map((figure) => [figure.id, figure])
);

/* The figures of a pack, in the order it holds them. */
export function packFigures(id: PetPackId): readonly DrawnSprite[] {
    return PET_PACKS.find((pack) => pack.id === id)?.figures ?? [];
}

/* A built-in figure by its id, while there is one by that id. */
export function petFigure(id: string): DrawnSprite | undefined {
    return FIGURES.get(id);
}

/* The figure a provider pack gives an agent: its own provider's, or Claude's for a CLI without one. */
export function providerFigure(pack: 'buddies' | 'animals', agent: string | undefined): DrawnSprite {
    const entry = PROVIDER_FIGURES.find((each) => each.agent === agent) ?? PROVIDER_FIGURES[0];

    return pack === 'animals' ? entry.animal : entry.buddy;
}
