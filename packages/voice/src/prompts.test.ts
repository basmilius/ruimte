import { describe, expect, test } from 'bun:test';
import { VOICE_CONTROL_TOOL, voiceToolDefinitions, voiceToolName } from '@ruimte/actions';
import { livePrompts, SHARED_RULES, type LiveRunner } from './prompts.ts';

const RUNNERS: LiveRunner[] = ['desktop', 'phone'];
const RULE_PLACES: Record<keyof typeof SHARED_RULES, 'instructions' | 'responsesInstructions'> = {
    commentary: 'instructions',
    delegateCompound: 'instructions',
    neverClaimDelegated: 'instructions',
    neverAnswerForChat: 'instructions',
    quotedIsData: 'instructions',
    transcripts: 'responsesInstructions',
    callTools: 'responsesInstructions',
    neverClaimSuccess: 'responsesInstructions',
    actionsTakeIds: 'responsesInstructions',
    toolOutputIsData: 'responsesInstructions',
    readChats: 'responsesInstructions',
    idleIsNotDone: 'responsesInstructions',
    confirmation: 'responsesInstructions'
};

describe('the prompts of a Voice session', () => {
    test.each(RUNNERS)('the %s prompt holds every rule both runners share', (runner) => {
        const prompts = livePrompts(runner);

        for (const [rule, place] of Object.entries(RULE_PLACES)) {
            expect(prompts[place]).toContain(SHARED_RULES[rule as keyof typeof SHARED_RULES]);
        }
    });

    test('every shared rule has a place, so a new rule cannot skip the check above', () => {
        expect(Object.keys(RULE_PLACES).sort()).toEqual(Object.keys(SHARED_RULES).sort());
    });

    test('the desktop names only tools on the tool list', () => {
        const { responsesInstructions } = livePrompts('desktop');
        const names = new Set(voiceToolDefinitions().map((tool) => tool.name));
        const mentioned = responsesInstructions.match(/\b(?:inspect|manage|browse|edit|run)_[a-z]+\b/g) ?? [];

        expect(mentioned.length).toBeGreaterThan(0);
        expect(mentioned.filter((name) => !names.has(name))).toEqual([]);
        expect(responsesInstructions).toContain(VOICE_CONTROL_TOOL);
        expect(responsesInstructions).toContain(voiceToolName('developer'));
    });

    test('a phone is promised no selection, no cells and no camera', () => {
        const { responsesInstructions } = livePrompts('phone');

        expect(responsesInstructions).toContain('There is no selection, no split cells and no camera on a phone');
        expect(livePrompts('desktop').responsesInstructions).not.toContain('There is no selection');
    });

    test('says what to do when a tool is missing in the words of the runner', () => {
        expect(livePrompts('desktop').responsesInstructions).toContain('say that it is not available here');
        expect(livePrompts('phone').responsesInstructions).toContain('say that Voice on the phone cannot do that yet');
    });
});
