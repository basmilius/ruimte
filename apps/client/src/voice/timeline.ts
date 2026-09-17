import type { VoiceAction, VoiceUtterance } from '@/voice/state';

export type VoiceTimelineEntry =
    | { kind: 'utterance'; item: VoiceUtterance }
    | { kind: 'action'; item: VoiceAction }
    | { kind: 'action-group'; items: VoiceAction[]; order: number };

export const voiceTimeline = (transcript: VoiceUtterance[], actions: VoiceAction[]): VoiceTimelineEntry[] => {
    const ordered: VoiceTimelineEntry[] = [
        ...transcript.map((item): VoiceTimelineEntry => ({ kind: 'utterance', item })),
        ...actions.map((item): VoiceTimelineEntry => ({ kind: 'action', item }))
    ].sort((left, right) => ('item' in left ? left.item.order : left.order) - ('item' in right ? right.item.order : right.order));
    const grouped: VoiceTimelineEntry[] = [];
    for (const entry of ordered) {
        const previous = grouped.at(-1);
        if (entry.kind !== 'action' || entry.item.kind !== 'note') {
            grouped.push(entry);
        } else if (previous?.kind === 'action' && previous.item.kind === 'note') {
            grouped[grouped.length - 1] = { kind: 'action-group', items: [previous.item, entry.item], order: previous.item.order };
        } else if (previous?.kind === 'action-group') {
            previous.items.push(entry.item);
        } else {
            grouped.push(entry);
        }
    }
    return grouped;
};
