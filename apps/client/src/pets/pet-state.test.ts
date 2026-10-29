import { describe, expect, test } from 'bun:test';
import type { AgentInfo, AgentStatus } from '@ruimte/contracts';
import type { ChatState } from '@adecore/agents-react/state';
import { CLAUDE_BUDDY, CODEX_BUDDY } from '@/pets/buddies';
import { FOX_SPRITE, FROG_SPRITE } from '@/pets/animals';
import { JUMP_ROWS, PET_POSES } from '@/pets/pixel';
import { agentPetChoice, builtInSprite, petChoiceFor, petFrame, petOf, petPoolOf, petSetsWith, type PetChoice } from '@/pets/pet-state';
import type { SessionsByKey, SessionState, StatusOf } from '@/state/sessions';
import type { Snoozes } from '@/state/snooze';
import type { ChatStatuses } from '@adecore/agents-react/state';
import { chatInfoOf } from '../../testing/chat-info';

function agent(status: AgentStatus, kind = 'claude'): AgentInfo {
    return { kind, agentSessionId: 'a1', transcriptPath: null, status, live: true, updatedAt: 0 };
}

function session(info?: AgentInfo): SessionState {
    return { attached: true, agent: info };
}

function chat(id: string, status: AgentStatus, provider = 'claude'): ChatState {
    return { info: chatInfoOf(id, { status, provider }), items: {}, structure: {}, order: [] };
}

// A chat and two terminals, as a node on a canvas or a view of its own names them: no place, only what the status needs.
const AGENTS: readonly StatusOf[] = [
    { id: 'writer', kind: 'chat' },
    { id: 'shell', kind: 'terminal' },
    { id: 'agent', kind: 'terminal' }
];

/* The pets of the nodes that have an agent in them. */
function petsOf(nodes: readonly StatusOf[], sessions: SessionsByKey, chats: ChatStatuses, snoozes: Snoozes) {
    return nodes.flatMap((node) => {
        const pet = petOf(node, sessions, chats, 'local', snoozes);
        return pet === null ? [] : [{ id: node.id, ...pet }];
    });
}

describe('what a pet shows', () => {
    test('a question or an approval waiting on you, on a chat and on a terminal alike', () => {
        const pets = petsOf(AGENTS, { 'local:agent': session(agent('needs-you')) }, { 'local:writer': chat('writer', 'needs-you') }, {});
        expect(pets.map((pet) => pet.mood)).toEqual(['waiting', 'waiting']);
    });

    test('a snoozed wait keeps its bubble until it is answered, and does not jump', () => {
        const snoozes = { 'local:writer': 2_000 };
        const pets = petsOf(AGENTS, {}, { 'local:writer': chat('writer', 'needs-you') }, snoozes);
        expect(pets[0].mood).toBe('snoozed');
        const frames = Array.from({ length: 8 }, (_, tick) => petFrame('snoozed', tick, false));
        expect(frames.every((frame) => frame.bubble && frame.pose === 'wait' && frame.lift === 0)).toBe(true);
        // Answered, the snooze has nothing left to hold, and the pet rests.
        expect(petsOf(AGENTS, {}, { 'local:writer': chat('writer', 'idle') }, snoozes)[0].mood).toBe('idle');
    });

    test('a turn, a rest and an end that went wrong', () => {
        const mood = (status: AgentStatus) => petsOf(AGENTS, {}, { 'local:writer': chat('writer', status) }, {})[0].mood;
        expect(mood('running')).toBe('working');
        expect(mood('idle')).toBe('idle');
        expect(mood('error')).toBe('stopped');
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
    test('Codex has its own, and every other CLI gets the one Claude has', () => {
        expect(builtInSprite('buddies', 'codex')).toBe(CODEX_BUDDY);
        expect(builtInSprite('buddies', 'claude')).toBe(CLAUDE_BUDDY);
        expect(builtInSprite('buddies', 'gemini')).toBe(CLAUDE_BUDDY);
        expect(builtInSprite('animals', 'codex')).toBe(FROG_SPRITE);
        expect(builtInSprite('animals', undefined)).toBe(FOX_SPRITE);
    });

    test('every pose of every figure draws inside its grid', () => {
        for (const sprite of [CLAUDE_BUDDY, CODEX_BUDDY, FOX_SPRITE, FROG_SPRITE]) {
            for (const pose of PET_POSES) {
                for (let frame = 0; frame < 12; frame++) {
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

    test('leaves a CLI without one, a visitor and a figure removed since to the pool', () => {
        const byAgent = { claude: 'custom:gone' };
        expect(agentPetChoice(byAgent, 'claude', [ANIMALS], CATS, 'writer')).toEqual(ANIMALS);
        expect(agentPetChoice(byAgent, 'gemini', [ANIMALS], CATS, 'writer')).toEqual(ANIMALS);
        expect(agentPetChoice(byAgent, undefined, [ANIMALS], CATS, 'writer')).toEqual(ANIMALS);
    });
});
