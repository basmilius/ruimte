import { expect, test } from 'bun:test';
import { joinTranscript, transcriptText } from './transcript';

test('live snapshots replace earlier words without introducing spaces inside a word', () => {
    const result = joinTranscript([
        { text: 'work', final: false },
        { text: 'worktree', final: false },
        { text: 'Worktree.', final: true }
    ]);
    expect(result).toEqual({ settled: 'Worktree.', pending: '' });
    expect(transcriptText(result)).toBe('Worktree.');
});
test('empty recognition leaves no provisional words behind', () => {
    expect(
        transcriptText(
            joinTranscript([
                { text: 'maybe', final: false },
                { text: '', final: true }
            ])
        )
    ).toBe('');
    expect(transcriptText(joinTranscript([]))).toBe('');
});
