import { describe, expect, test } from 'bun:test';
import type { AgentInfo } from '@ruimte/extension/client';
import { FOX_SPRITE, FROG_SPRITE } from './animals';
import { CLAUDE_BUDDY, CODEX_BUDDY } from './buddies';
import { EXTRA_FIGURES, PET_PACKS, packFigures } from './catalog';
import { agentPetChoice, builtInSprite, petChoiceFor, petFrame, petOf, petPoolOf, petSetsWith, type PetChoice } from './pet-state';
import { DRAWN_CYCLE, JUMP_ROWS, PET_POSES, type DrawnSprite } from './pixel';

/* An agent as `useAgent` reads it: resting, unless the test says otherwise. */
function agent(patch: Partial<AgentInfo> = {}): AgentInfo {
    return { provider: 'claude', account: null, status: 'idle', activity: null, snoozed: false, cwd: null, branch: null, worktree: null, ...patch };
}

describe('what a pet shows', () => {
    test('a question or an approval waiting on you, and no pet where no agent runs', () => {
        expect(petOf(agent({ status: 'needsYou' }))?.mood).toBe('waiting');
        expect(petOf(null)).toBeNull();
    });

    test('an agent whose CLI is not known yet takes the pack default, never the figure a person gave Claude', () => {
        const pet = petOf(agent({ provider: null }));
        const pool: PetChoice[] = [{ kind: 'built-in', set: 'buddies' }];

        expect(pet?.agent).toBeUndefined();
        expect(builtInSprite('buddies', pet?.agent, 'n1')).toBe(CLAUDE_BUDDY);
        expect(agentPetChoice({ claude: 'figure:nox' }, pet?.agent, pool, [], 'n1')).toEqual(pool[0]);
    });

    test('a snoozed wait keeps its bubble until it is answered, and does not jump', () => {
        expect(petOf(agent({ status: 'needsYou', snoozed: true }))?.mood).toBe('snoozed');
        const frames = Array.from({ length: 8 }, (_, tick) => petFrame('snoozed', tick, false));
        expect(frames.every((frame) => frame.bubble && frame.pose === 'wait' && frame.lift === 0)).toBe(true);
    });

    test('works on a turn, for agents it handed work to and on commands it left running; rests, or stopped after an end', () => {
        expect((['turn', 'delegating', 'background'] as const).map((activity) => petOf(agent({ status: 'running', activity }))?.mood)).toEqual([
            'working',
            'working',
            'working'
        ]);
        expect(petOf(agent())?.mood).toBe('idle');
        expect(petOf(agent({ status: 'stopped' }))?.mood).toBe('stopped');
        expect(petOf(agent({ provider: 'codex' }))?.agent).toBe('codex');
    });

    test('a waiting pet has a bubble and jumps, and lands again before the next jump', () => {
        const frames = Array.from({ length: 8 }, (_, tick) => petFrame('waiting', tick, false));
        expect(frames.every((frame) => frame.bubble && frame.pose === 'wait')).toBe(true);
        expect(Math.max(...frames.map((frame) => frame.lift))).toBe(JUMP_ROWS);
        expect(frames[0].lift).toBe(0);
        expect(frames.at(-1)?.lift).toBe(0);
    });

    test('with reduced motion nothing moves: a waiting pet keeps its bubble, and every pet holds one frame', () => {
        const frames = Array.from({ length: 8 }, (_, tick) => petFrame('waiting', tick, true));
        expect(frames.every((frame) => frame.bubble && frame.lift === 0)).toBe(true);
        for (const mood of ['waiting', 'snoozed', 'working', 'idle', 'stopped', 'visiting'] as const) {
            const still = Array.from({ length: 24 }, (_, tick) => petFrame(mood, tick, true));
            expect(new Set(still.map((frame) => JSON.stringify(frame))).size).toBe(1);
        }
    });

    test('no bubble and no jump once the question is answered', () => {
        for (const mood of ['working', 'idle', 'stopped', 'visiting'] as const) {
            const frames = Array.from({ length: 8 }, (_, tick) => petFrame(mood, tick, false));
            expect(frames.some((frame) => frame.bubble || frame.lift !== 0)).toBe(false);
        }
    });
});

describe('the figures', () => {
    test('the buddies and the animals give every provider its own, and a CLI without one the one Claude has', () => {
        expect(builtInSprite('buddies', 'codex', 'writer')).toBe(CODEX_BUDDY);
        expect(builtInSprite('buddies', 'claude', 'writer')).toBe(CLAUDE_BUDDY);
        expect(builtInSprite('buddies', 'gemini', 'writer')).toBe(CLAUDE_BUDDY);
        expect(builtInSprite('buddies', 'antigravity', 'writer').id).toBe('orbit');
        expect(builtInSprite('animals', 'codex', 'writer')).toBe(FROG_SPRITE);
        expect(builtInSprite('animals', undefined, 'writer')).toBe(FOX_SPRITE);
        expect(builtInSprite('animals', 'nanogpt', 'writer').id).toBe('nano-bee');
    });

    test('any other pack spreads its figures over the nodes, the same one for a node every time', () => {
        const NODES = Array.from({ length: 60 }, (_, i) => `node-${i}`);
        const figures = NODES.map((id) => builtInSprite('woodland', 'claude', id).id);

        expect(NODES.map((id) => builtInSprite('woodland', 'codex', id).id)).toEqual(figures);
        expect(new Set(figures)).toEqual(new Set(packFigures('woodland').map((figure) => figure.id)));
    });

    test('the catalog holds 54 figures in 11 packs, each id once', () => {
        const figures = [...PET_PACKS.flatMap((pack) => pack.figures as readonly DrawnSprite[]), ...EXTRA_FIGURES];

        expect(PET_PACKS).toHaveLength(11);
        expect(figures).toHaveLength(54);
        expect(new Set(figures.map((figure) => figure.id)).size).toBe(54);
    });

    test('every pose of every figure draws inside its grid', () => {
        for (const sprite of [...PET_PACKS.flatMap((pack) => pack.figures as readonly DrawnSprite[]), ...EXTRA_FIGURES]) {
            for (const pose of PET_POSES) {
                for (let frame = 0; frame < DRAWN_CYCLE; frame++) {
                    const parts = sprite.poses[pose](frame);
                    for (const part of [...parts.silhouette, ...parts.details, ...parts.props]) {
                        expect(part.x).toBeGreaterThanOrEqual(0);
                        expect(part.y).toBeGreaterThanOrEqual(-1);
                        expect(part.x + part.w).toBeLessThanOrEqual(26);
                        expect(part.y + part.h).toBeLessThanOrEqual(18);
                    }
                }
            }
        }
    });

    test('every pose of every figure has a bow and repeats after the paint cycle', () => {
        for (const sprite of [...PET_PACKS.flatMap((pack) => pack.figures as readonly DrawnSprite[]), ...EXTRA_FIGURES]) {
            for (const pose of PET_POSES) {
                for (let frame = 0; frame < DRAWN_CYCLE; frame++) {
                    expect(sprite.poses[pose](frame).bow?.length ?? 0).toBeGreaterThan(0);
                    expect(sprite.poses[pose](frame + DRAWN_CYCLE)).toEqual(sprite.poses[pose](frame));
                }
            }
        }
    });
});

describe('the sets pets come from', () => {
    const NODES = Array.from({ length: 60 }, (_, i) => `node-${i}`);
    const BUDDIES: PetChoice = { kind: 'built-in', set: 'buddies' };
    const ANIMALS: PetChoice = { kind: 'built-in', set: 'animals' };

    test('are the ones named that are still there, each once, the built-in ones first', () => {
        expect(petPoolOf(['custom:a1', 'animals', 'buddies', 'animals'], ['a1', 'b2'])).toEqual([BUDDIES, ANIMALS, { kind: 'custom', id: 'a1' }]);
        expect(petPoolOf(['custom:gone', 'animals'], ['a1'])).toEqual([ANIMALS]);
    });

    test('are the buddies when nothing named is left', () => {
        expect(petPoolOf(['custom:gone'], ['a1'])).toEqual([BUDDIES]);
        expect(petPoolOf(['dragons'], [])).toEqual([BUDDIES]);
        expect(petPoolOf([], [])).toEqual([BUDDIES]);
    });

    test('give a node the same set every time, whatever order they were picked in', () => {
        const pool = petPoolOf(['buddies', 'animals', 'custom:a1'], ['a1']);
        const reversed = [...pool].reverse();
        for (const id of NODES) {
            expect(petChoiceFor(pool, id)).toEqual(petChoiceFor(pool, id));
            expect(petChoiceFor(reversed, id)).toEqual(petChoiceFor(pool, id));
        }
    });

    test('spread the nodes over every set in the pool', () => {
        const pool = petPoolOf(['buddies', 'animals', 'custom:a1'], ['a1']);
        const used = new Set(NODES.map((id) => JSON.stringify(petChoiceFor(pool, id))));
        expect(used.size).toBe(3);
    });

    test('move only the pets of a set that joins or leaves, and keep every other pet as it was', () => {
        const two = petPoolOf(['buddies', 'animals'], ['a1']);
        const three = petPoolOf(['buddies', 'animals', 'custom:a1'], ['a1']);
        for (const id of NODES) {
            const after = petChoiceFor(three, id);
            if (after.kind !== 'custom') {
                expect<PetChoice>(after).toEqual(petChoiceFor(two, id));
            }
        }
    });

    test('one set picked is the one set every pet has', () => {
        for (const id of NODES) {
            expect(petChoiceFor([ANIMALS], id)).toEqual(ANIMALS);
        }
    });

    test('pick and leave out a set, never the last one', () => {
        expect(petSetsWith([BUDDIES], 'animals', true)).toEqual(['buddies', 'animals']);
        expect(petSetsWith([BUDDIES, ANIMALS], 'buddies', false)).toEqual(['animals']);
        expect(petSetsWith([ANIMALS], 'animals', false)).toEqual(['animals']);
    });
});

describe('a figure per agent', () => {
    const BUDDIES: PetChoice = { kind: 'built-in', set: 'buddies' };
    const ANIMALS: PetChoice = { kind: 'built-in', set: 'animals' };
    const CATS = ['tabby', 'tux'];

    test('gives a CLI the figure a person picked for it, whatever the pool says', () => {
        const byAgent = { claude: 'custom:tabby', codex: 'custom:tux' };
        expect(agentPetChoice(byAgent, 'claude', [BUDDIES], CATS, 'writer')).toEqual({ kind: 'custom', id: 'tabby' });
        expect(agentPetChoice(byAgent, 'codex', [BUDDIES], CATS, 'writer')).toEqual({ kind: 'custom', id: 'tux' });
        expect(agentPetChoice({ claude: 'animals' }, 'claude', [BUDDIES], CATS, 'writer')).toEqual(ANIMALS);
    });

    test('gives a CLI one fixed figure of the catalog, and leaves it to the pool for an id that is gone', () => {
        expect(agentPetChoice({ codex: 'figure:nox' }, 'codex', [BUDDIES], CATS, 'writer')).toEqual({ kind: 'figure', id: 'nox' });
        expect(agentPetChoice({ codex: 'figure:dragon' }, 'codex', [ANIMALS], CATS, 'writer')).toEqual(ANIMALS);
    });

    test('leaves a CLI without one, a visitor and a figure removed since to the pool', () => {
        const byAgent = { claude: 'custom:gone' };
        expect(agentPetChoice(byAgent, 'claude', [ANIMALS], CATS, 'writer')).toEqual(ANIMALS);
        expect(agentPetChoice(byAgent, 'gemini', [ANIMALS], CATS, 'writer')).toEqual(ANIMALS);
        expect(agentPetChoice(byAgent, undefined, [ANIMALS], CATS, 'writer')).toEqual(ANIMALS);
    });
});
