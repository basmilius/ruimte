import { describe, expect, test } from 'bun:test';
import { ActivityLog, describeActivity } from './activity.ts';

describe('ActivityLog', () => {
    test('keeps only the last ten things the main thread began', () => {
        const log = new ActivityLog();

        for (let i = 0; i < 12; i++) {
            log.note(`request project.list ${i}`, i * 1000);
        }

        const recent = log.recent();

        expect(recent).toHaveLength(10);
        expect(recent[0]).toEqual({ label: 'request project.list 2', at: 2000 });
        expect(recent.at(-1)).toEqual({ label: 'request project.list 11', at: 11_000 });
    });
});

describe('describeActivity', () => {
    test('names the newest first, with how long before the block it began', () => {
        const entries = [
            { label: 'request project.open', at: 1000 },
            { label: 'tool node_list', at: 4500 }
        ];

        expect(describeActivity(entries, 9500)).toEqual(['tool node_list 5.0 s before', 'request project.open 8.5 s before']);
    });
});
