'use client';

import { KeyValueList } from '@adecore/ui';
import { InlineDoc } from '@/components/docs/InlineDoc';
import type { SlotEntry } from '@/lib/docs/reference';

export function SlotList({ slots }: { readonly slots: readonly SlotEntry[] }) {
    return (
        <KeyValueList.Root divided className="slot-list">
            {slots.map((slot) => (
                <KeyValueList.Item key={slot.name}>
                    <KeyValueList.Name>
                        <code>{slot.name}</code>
                    </KeyValueList.Name>
                    <KeyValueList.Value className="text-text-muted">
                        <code>{slot.context === '{}' ? 'nothing more' : slot.context}</code>
                        {slot.doc !== null && (
                            <p>
                                <InlineDoc text={slot.doc} />
                            </p>
                        )}
                    </KeyValueList.Value>
                </KeyValueList.Item>
            ))}
        </KeyValueList.Root>
    );
}
