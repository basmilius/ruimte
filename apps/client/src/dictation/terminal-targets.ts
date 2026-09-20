import { create } from 'zustand';
import { endpointKey } from '@/state/keys';
import type { DictationTarget } from './controller';

export const terminalTargetKey = endpointKey;

export const useTerminalDictationTargets = create<{ targets: ReadonlyMap<string, DictationTarget> }>(() => ({ targets: new Map() }));

export function registerTerminalDictationTarget(key: string, target: DictationTarget): () => void {
    useTerminalDictationTargets.setState(({ targets }) => ({ targets: new Map(targets).set(key, target) }));
    return () => {
        useTerminalDictationTargets.setState(({ targets }) => {
            if (targets.get(key) !== target) return {};
            const next = new Map(targets);
            next.delete(key);
            return { targets: next };
        });
    };
}
