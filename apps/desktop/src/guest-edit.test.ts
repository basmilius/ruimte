import { describe, expect, test } from 'bun:test';
import { editFrameOf, runGuestEdit, type ScriptFrame } from './guest-edit';

interface FakeFrame extends ScriptFrame {
    calls: { code: string; userGesture?: boolean }[];
}

const fakeFrame = (state: { destroyed?: boolean; detached?: boolean } = {}): FakeFrame => {
    const calls: FakeFrame['calls'] = [];
    return {
        calls,
        detached: state.detached ?? false,
        isDestroyed: () => state.destroyed ?? false,
        executeJavaScript: (code, userGesture) => {
            calls.push({ code, userGesture });
            return Promise.resolve(true);
        }
    };
};

describe('runGuestEdit', () => {
    test('selects all inside the guest frame, whatever holds the focus', () => {
        const frame = fakeFrame();
        runGuestEdit(frame, 'select-all');
        expect(frame.calls).toEqual([{ code: "document.execCommand('selectAll')", userGesture: true }]);
    });

    test('copies inside the guest frame as a gesture, so the page may write the clipboard', () => {
        const frame = fakeFrame();
        runGuestEdit(frame, 'copy');
        expect(frame.calls).toEqual([{ code: "document.execCommand('copy')", userGesture: true }]);
    });

    test('a page that refuses the script is not an error', async () => {
        const frame: ScriptFrame = { detached: false, isDestroyed: () => false, executeJavaScript: () => Promise.reject(new Error('gone')) };
        expect(() => runGuestEdit(frame, 'copy')).not.toThrow();
        await Promise.resolve();
    });
});

describe('editFrameOf', () => {
    test('acts in the frame the right-click landed in', () => {
        const clicked = fakeFrame();
        const main = fakeFrame();
        expect(editFrameOf(clicked, main)).toBe(clicked);
    });

    test('falls back to the main frame once the clicked frame left its page', () => {
        const main = fakeFrame();
        expect(editFrameOf(undefined, main)).toBe(main);
        expect(editFrameOf(fakeFrame({ detached: true }), main)).toBe(main);
        expect(editFrameOf(fakeFrame({ destroyed: true }), main)).toBe(main);
    });
});
