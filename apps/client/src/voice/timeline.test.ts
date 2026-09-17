import { describe, expect, test } from 'bun:test';
import type { VoiceAction, VoiceUtterance } from '@/voice/state';
import { voiceTimeline } from '@/voice/timeline';

const action = (id: string, order: number, kind: VoiceAction['kind'] = 'note'): VoiceAction => ({
    id,
    order,
    kind,
    status: 'completed',
    label: kind === 'note' ? 'Added note' : 'Focused view',
    detail: id,
    undoable: true
});

const utterance = (order: number): VoiceUtterance => ({
    id: `utterance-${order}`,
    order,
    speaker: 'assistant',
    text: 'Done',
    startMs: 0,
    endMs: 1,
    interrupted: false
});

describe('voice timeline', () => {
    test('groups consecutive note creations', () => {
        const timeline = voiceTimeline([], [action('one', 1), action('two', 2), action('three', 3), action('four', 4)]);

        expect(timeline).toEqual([{ kind: 'action-group', items: expect.any(Array), order: 1 }]);
        expect(timeline[0]?.kind === 'action-group' ? timeline[0].items.map((item) => item.id) : []).toEqual(['one', 'two', 'three', 'four']);
    });

    test('keeps single notes separate and breaks a group at conversation or another action', () => {
        const timeline = voiceTimeline([utterance(3)], [action('one', 1), action('two', 2), action('focus', 4, 'focus'), action('three', 5)]);

        expect(timeline.map((entry) => entry.kind)).toEqual(['action-group', 'utterance', 'action', 'action']);
    });
});
