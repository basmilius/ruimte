import { describe, expect, test } from 'bun:test';
import type { FlowCard, FlowCardKind, FlowContent, FlowLink, FlowPort } from '@ruimte/contracts';
import { missingArgsOf, portForOutcome, portsOf, defaultArgsOf } from './cards.ts';
import { recipeFingerprint } from './fingerprint.ts';
import { flowProblemIn, triggerIdsIn } from './graph.ts';
import { beginCard, readyCards, runFinished, settleCard, startRun, type FlowRunState } from './run.ts';
import { brokenTokenRefsIn, fillTokens, tokenRef, visibleTokens } from './tokens.ts';

const card = (kind: FlowCardKind, over: Partial<FlowCard> = {}): FlowCard => ({ kind, args: {}, x: 0, y: 0, ...over });

const link = (from: string, fromPort: FlowPort, to: string): FlowLink => ({ from, fromPort, to });

const flow = (cards: Record<string, FlowCard>, links: FlowLink[] = []): FlowContent => ({ cards, links });

/*
 * Walks a run the way the daemon does: everything ready goes out together, and the answer of each
 * card comes from the test. What comes back is the order the cards ran in, grouped per round.
 */
const walk = (content: FlowContent, entry: string, answer: (id: string) => FlowPort | null): string[][] => {
    let state: FlowRunState = startRun(entry);
    const rounds: string[][] = [];
    while (!runFinished(content, state)) {
        const ready = readyCards(content, state);
        rounds.push(ready);
        for (const id of ready) {
            state = beginCard(state, id);
        }
        for (const id of ready) {
            state = settleCard(state, id, answer(id));
        }
    }
    return rounds;
};

describe('how a run walks the graph', () => {
    test('a branch that reaches a port nobody drew from stops there', () => {
        const content = flow(
            {
                trigger: card('trigger', { card: 'files.changed' }),
                check: card('condition', { card: 'text.contains' }),
                shout: card('action', { card: 'person.notify' })
            },
            [link('trigger', 'done', 'check'), link('check', 'true', 'shout')]
        );
        expect(walk(content, 'trigger', (id) => (id === 'check' ? 'false' : 'done'))).toEqual([['trigger'], ['check']]);
        expect(walk(content, 'trigger', (id) => (id === 'check' ? 'true' : 'done'))).toEqual([['trigger'], ['check'], ['shout']]);
    });

    test('two lines out of one port are two branches that run side by side', () => {
        const content = flow(
            {
                trigger: card('trigger', { card: 'files.changed' }),
                left: card('action', { card: 'person.notify' }),
                right: card('action', { card: 'person.notify' })
            },
            [link('trigger', 'done', 'left'), link('trigger', 'done', 'right')]
        );
        expect(walk(content, 'trigger', () => 'done')).toEqual([['trigger'], ['left', 'right']]);
    });

    test('an all card waits until every branch on it arrived or died', () => {
        const content = flow(
            {
                trigger: card('trigger', { card: 'files.changed' }),
                slow: card('delay'),
                check: card('condition', { card: 'text.contains' }),
                join: card('all'),
                shout: card('action', { card: 'person.notify' })
            },
            [
                link('trigger', 'done', 'slow'),
                link('trigger', 'done', 'check'),
                link('slow', 'done', 'join'),
                link('check', 'true', 'join'),
                link('join', 'done', 'shout')
            ]
        );
        let state = startRun('trigger');
        state = settleCard(beginCard(state, 'trigger'), 'trigger', 'done');
        state = settleCard(beginCard(state, 'check'), 'check', 'true');
        // One branch is in, the other is still in the wait card: the join holds.
        expect(readyCards(content, state)).toEqual(['slow']);
        state = settleCard(beginCard(state, 'slow'), 'slow', 'done');
        expect(readyCards(content, state)).toEqual(['join']);
    });

    test('an all card goes on when a branch died, and stops when they all did', () => {
        const content = flow(
            {
                trigger: card('trigger', { card: 'files.changed' }),
                one: card('condition', { card: 'text.contains' }),
                other: card('condition', { card: 'text.contains' }),
                join: card('all'),
                shout: card('action', { card: 'person.notify' })
            },
            [
                link('trigger', 'done', 'one'),
                link('trigger', 'done', 'other'),
                link('one', 'true', 'join'),
                link('other', 'true', 'join'),
                link('join', 'done', 'shout')
            ]
        );
        expect(walk(content, 'trigger', (id) => (id === 'one' ? 'true' : id === 'other' ? 'false' : 'done'))).toEqual([
            ['trigger'],
            ['one', 'other'],
            ['join'],
            ['shout']
        ]);
        expect(walk(content, 'trigger', (id) => (id === 'trigger' ? 'done' : 'false'))).toEqual([['trigger'], ['one', 'other']]);
    });

    test('an any card goes on with the first branch that arrives', () => {
        const content = flow(
            {
                trigger: card('trigger', { card: 'files.changed' }),
                slow: card('delay'),
                pick: card('any'),
                shout: card('action', { card: 'person.notify' })
            },
            [link('trigger', 'done', 'slow'), link('trigger', 'done', 'pick'), link('slow', 'done', 'pick'), link('pick', 'done', 'shout')]
        );
        expect(walk(content, 'trigger', () => 'done')).toEqual([['trigger'], ['pick', 'slow'], ['shout']]);
    });

    test('a card two branches reach runs once', () => {
        const content = flow(
            {
                trigger: card('trigger', { card: 'files.changed' }),
                left: card('delay'),
                right: card('delay'),
                shout: card('action', { card: 'person.notify' })
            },
            [link('trigger', 'done', 'left'), link('trigger', 'done', 'right'), link('left', 'done', 'shout'), link('right', 'done', 'shout')]
        );
        const rounds = walk(content, 'trigger', () => 'done');
        expect(rounds.flat().filter((id) => id === 'shout')).toHaveLength(1);
    });

    test('an island nobody triggered never runs, and the run ends when nothing is left', () => {
        const content = flow(
            {
                trigger: card('trigger', { card: 'files.changed' }),
                shout: card('action', { card: 'person.notify' }),
                other: card('trigger', { card: 'time.at' }),
                elsewhere: card('action', { card: 'person.notify' })
            },
            [link('trigger', 'done', 'shout'), link('other', 'done', 'elsewhere')]
        );
        expect(walk(content, 'trigger', () => 'done')).toEqual([['trigger'], ['shout']]);
        expect(runFinished(content, settleCard(startRun('trigger'), 'trigger', null))).toBe(true);
    });

    test('a card that went nowhere kills every line out of it', () => {
        const content = flow(
            {
                trigger: card('trigger', { card: 'files.changed' }),
                message: card('action', { card: 'chat.message' }),
                shout: card('action', { card: 'person.notify' })
            },
            [link('trigger', 'done', 'message'), link('message', 'done', 'shout'), link('message', 'error', 'shout')]
        );
        expect(walk(content, 'trigger', (id) => (id === 'message' ? null : 'done'))).toEqual([['trigger'], ['message']]);
    });
});

describe('the ports of a card', () => {
    test('a trigger has one, a condition two, and an action gets an error port only when it can fail', () => {
        expect(portsOf(card('trigger', { card: 'files.changed' }))).toEqual(['done']);
        expect(portsOf(card('condition', { card: 'text.contains' }))).toEqual(['true', 'false']);
        expect(portsOf(card('action', { card: 'person.notify' }))).toEqual(['done']);
        expect(portsOf(card('action', { card: 'chat.message' }))).toEqual(['done', 'error']);
        expect(portsOf(card('note'))).toEqual([]);
    });

    test('inverted turns a condition around and nothing else', () => {
        expect(portForOutcome(card('condition'), true)).toBe('true');
        expect(portForOutcome(card('condition', { inverted: true }), true)).toBe('false');
        expect(portForOutcome(card('condition', { inverted: true }), false)).toBe('true');
    });
});

describe('what a recipe is refused for', () => {
    test('a line to a card that is not there', () => {
        expect(flowProblemIn(flow({ a: card('trigger', { card: 'time.at' }) }, [link('a', 'done', 'b')]))).toContain('card b');
    });

    test('a line that lands on a trigger', () => {
        const content = flow({ a: card('trigger', { card: 'time.at' }), b: card('trigger', { card: 'time.at' }) }, [link('a', 'done', 'b')]);
        expect(flowProblemIn(content)).toContain('takes nothing in');
    });

    test('a line out of a port the card does not have', () => {
        const content = flow({ a: card('trigger', { card: 'time.at' }), b: card('action', { card: 'person.notify' }) }, [link('a', 'true', 'b')]);
        expect(flowProblemIn(content)).toContain('no true port');
    });

    test('a card from a newer build keeps its lines, because that file has to open here too', () => {
        const content = flow({ a: card('trigger', { card: 'mail.arrived' }), b: card('action', { card: 'person.notify' }) }, [link('a', 'error', 'b')]);
        expect(flowProblemIn(content)).toBeNull();
    });

    test('the same two cards joined twice by one port', () => {
        const content = flow({ a: card('trigger', { card: 'time.at' }), b: card('action', { card: 'person.notify' }) }, [
            link('a', 'done', 'b'),
            link('a', 'done', 'b')
        ]);
        expect(flowProblemIn(content)).toContain('twice');
    });

    test('a sound worksheet, with its triggers in a fixed order', () => {
        const content = flow(
            {
                zebra: card('trigger', { card: 'time.at' }),
                alpha: card('start'),
                shout: card('action', { card: 'person.notify' })
            },
            [link('zebra', 'done', 'shout'), link('alpha', 'done', 'shout')]
        );
        expect(flowProblemIn(content)).toBeNull();
        expect(triggerIdsIn(content)).toEqual(['alpha', 'zebra']);
    });
});

describe('which tokens a card may see', () => {
    const branched = flow(
        {
            trigger: card('trigger', { card: 'files.changed' }),
            clock: card('trigger', { card: 'time.at' }),
            left: card('start'),
            join: card('all'),
            shout: card('action', { card: 'person.notify' })
        },
        [link('trigger', 'done', 'join'), link('clock', 'done', 'join'), link('join', 'done', 'shout')]
    );

    test('a card sees what every path to it passed, not what one of them did', () => {
        // Two triggers lead into the join, so neither of their tokens is there every time.
        expect(visibleTokens(branched, 'shout')).toEqual([]);
    });

    test('a card on one chain sees the cards above it, trigger first', () => {
        const content = flow(
            {
                trigger: card('trigger', { card: 'files.changed' }),
                wait: card('delay'),
                shout: card('action', { card: 'person.notify' })
            },
            [link('trigger', 'done', 'wait'), link('wait', 'done', 'shout')]
        );
        expect(visibleTokens(content, 'shout').map((entry) => `${entry.cardId}.${entry.token.name}`)).toEqual(['trigger.path', 'trigger.content']);
    });

    test('a card no trigger reaches sees nothing', () => {
        expect(visibleTokens(flow({ lonely: card('action', { card: 'person.notify' }) }), 'lonely')).toEqual([]);
    });

    test('a reference to a token that is not on every path is broken', () => {
        const content: FlowContent = {
            ...branched,
            cards: { ...branched.cards, shout: card('action', { card: 'person.notify', args: { text: `Changed: ${tokenRef('trigger', 'path')}` } }) }
        };
        expect(brokenTokenRefsIn(content)).toEqual([{ cardId: 'trigger', token: 'path', text: '@[trigger.path]', on: 'shout', arg: 'text' }]);
    });

    test('a text is written out with the values of the run, and an empty one leaves nothing behind', () => {
        expect(fillTokens(`Changed: ${tokenRef('trigger', 'path')}`, { 'trigger.path': 'README.md' })).toBe('Changed: README.md');
        expect(fillTokens(`Changed: ${tokenRef('trigger', 'path')}`, {})).toBe('Changed: ');
    });
});

describe('the fields of a card', () => {
    test('a new card starts on the defaults of its catalog entry', () => {
        expect(defaultArgsOf('trigger', 'time.at')).toEqual({ every: 'day', at: '08:00', minutes: 15 });
        expect(defaultArgsOf('delay')).toEqual({ amount: 30, unit: 'seconds' });
    });

    test('a field only counts as missing while the card asks for it', () => {
        expect(missingArgsOf(card('trigger', { card: 'time.at', args: { every: 'day', at: '' } }))).toEqual(['at']);
        // On minutes the time is not asked for at all, so an empty one is not a hole.
        expect(missingArgsOf(card('trigger', { card: 'time.at', args: { every: 'minutes', at: '', minutes: 5 } }))).toEqual([]);
    });
});

describe('the fingerprint the switch hangs on', () => {
    const base = flow({ trigger: card('trigger', { card: 'files.changed', args: { path: 'README.md' } }), shout: card('action', { card: 'person.notify' }) }, [
        link('trigger', 'done', 'shout')
    ]);

    test('moving a card leaves it alone', () => {
        const moved: FlowContent = { ...base, cards: { ...base.cards, shout: card('action', { card: 'person.notify', x: 900, y: 40 }) } };
        expect(recipeFingerprint(moved)).toBe(recipeFingerprint(base));
    });

    test('a changed field, an inverted condition and a moved line each break it', () => {
        const field: FlowContent = { ...base, cards: { ...base.cards, trigger: card('trigger', { card: 'files.changed', args: { path: 'CHANGELOG.md' } }) } };
        expect(recipeFingerprint(field)).not.toBe(recipeFingerprint(base));
        const inverted: FlowContent = { ...base, cards: { ...base.cards, shout: card('action', { card: 'person.notify', inverted: true }) } };
        expect(recipeFingerprint(inverted)).not.toBe(recipeFingerprint(base));
        expect(recipeFingerprint({ ...base, links: [] })).not.toBe(recipeFingerprint(base));
    });

    test('the same recipe written in another order reads the same', () => {
        const shuffled: FlowContent = {
            cards: { shout: base.cards.shout as FlowCard, trigger: base.cards.trigger as FlowCard },
            links: [...base.links]
        };
        expect(recipeFingerprint(shuffled)).toBe(recipeFingerprint(base));
    });
});
