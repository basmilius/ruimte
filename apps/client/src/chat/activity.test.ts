import { describe, expect, test } from 'bun:test';
import type { ChatBackgroundTask } from '@ruimte/contracts';
import { backgroundCounts } from '@/chat/activity';

const task = (id: string, kind: ChatBackgroundTask['kind']): ChatBackgroundTask => ({ id, kind, description: '', command: null, startedAt: 0 });

describe('chat activity', () => {
    test('splits what runs in the background into shells and monitors', () => {
        expect(backgroundCounts([task('1', 'shell'), task('2', 'monitor'), task('3', 'shell')])).toEqual({ shells: 2, monitors: 1 });
    });
});
