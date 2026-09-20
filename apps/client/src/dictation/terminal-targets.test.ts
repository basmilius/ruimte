import { expect, test } from 'bun:test';
import type { DictationTarget } from './controller';
import { registerTerminalDictationTarget, terminalTargetKey, useTerminalDictationTargets } from './terminal-targets';

const target = (id: string): DictationTarget => ({ id, element: {} as HTMLElement, capture: () => null });

test('terminal controls resolve only a target on their own endpoint', () => {
    const local = terminalTargetKey('local', 'terminal');
    const remote = terminalTargetKey('remote', 'terminal');
    const first = target('local-target');
    const second = target('remote-target');
    const removeLocal = registerTerminalDictationTarget(local, first);
    const removeRemote = registerTerminalDictationTarget(remote, second);
    expect(useTerminalDictationTargets.getState().targets.get(local)).toBe(first);
    expect(useTerminalDictationTargets.getState().targets.get(remote)).toBe(second);
    removeLocal();
    expect(useTerminalDictationTargets.getState().targets.has(local)).toBe(false);
    expect(useTerminalDictationTargets.getState().targets.get(remote)).toBe(second);
    removeRemote();
});

test('cleanup of a replaced terminal cannot remove its new target', () => {
    const key = terminalTargetKey('local', 'restarted');
    const old = registerTerminalDictationTarget(key, target('old'));
    const fresh = target('new');
    const cleanup = registerTerminalDictationTarget(key, fresh);
    old();
    expect(useTerminalDictationTargets.getState().targets.get(key)).toBe(fresh);
    cleanup();
    expect(useTerminalDictationTargets.getState().targets.has(key)).toBe(false);
});
