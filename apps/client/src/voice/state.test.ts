import { beforeEach, describe, expect, test } from 'bun:test';
import { addTranscriptDelta, nextVoiceTimelineOrder, useVoice } from './state';

describe('voice transcript', () => {
    beforeEach(() => useVoice.setState({ transcript: [], actions: [], phase: 'idle', error: null }));

    test('keeps received model text when the user interrupts', () => {
        addTranscriptDelta('assistant', 'I can explain ', 1_000, 1_500);
        addTranscriptDelta('assistant', 'that.', 1_500, 2_000);
        addTranscriptDelta('user', 'Stop', 1_800, 2_100);

        expect(useVoice.getState().transcript).toMatchObject([
            { speaker: 'assistant', text: 'I can explain that.', interrupted: true },
            { speaker: 'user', text: 'Stop', interrupted: false }
        ]);
    });

    test('keeps later turns separate', () => {
        addTranscriptDelta('user', 'First', 0, 200);
        addTranscriptDelta('assistant', 'Second', 300, 600);
        addTranscriptDelta('user', 'Third', 2_000, 2_200);

        expect(useVoice.getState().transcript.map((utterance) => utterance.text)).toEqual(['First', 'Second', 'Third']);
    });

    test('keeps a paused speaker in one utterance without leading indentation', () => {
        addTranscriptDelta('user', ' Add a note', 0, 500);
        addTranscriptDelta('user', ' about tomorrow', 4_000, 4_500);

        expect(useVoice.getState().transcript.map((utterance) => utterance.text)).toEqual(['Add a note about tomorrow']);
    });

    test('keeps one assistant utterance together across a workspace action', () => {
        addTranscriptDelta('assistant', 'I will open it and ', 0, 500);
        useVoice.setState({
            actions: [
                {
                    id: 'action',
                    order: nextVoiceTimelineOrder(),
                    kind: 'terminal',
                    status: 'completed',
                    label: 'Opened terminal',
                    detail: 'On Main',
                    undoable: false
                }
            ]
        });
        addTranscriptDelta('assistant', 'show the result.', 500, 900);

        expect(useVoice.getState().transcript.map((utterance) => utterance.text)).toEqual(['I will open it and show the result.']);
        expect(useVoice.getState().transcript[0]!.order).toBeLessThan(useVoice.getState().actions[0]!.order);
    });
});
