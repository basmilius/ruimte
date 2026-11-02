import reference from '@/generated/reference.json';
import { InlineDoc } from '@/components/docs/InlineDoc';
import { slotsOf, type ReferenceModule } from '@/lib/docs/reference';

/* Every slot and what it tells, from `SlotContexts`, so the table never trails the types. */
export function SlotTable() {
    const client = (reference as ReferenceModule[]).find((module) => module.module === 'client');
    const slots = slotsOf(client?.entries ?? []);

    return (
        <table>
            <thead>
                <tr>
                    <th>Slot</th>
                    <th>What it tells, besides the base context</th>
                </tr>
            </thead>
            <tbody>
                {slots.map((slot) => (
                    <tr key={slot.name}>
                        <td>
                            <code>{slot.name}</code>
                        </td>
                        <td>
                            <code>{slot.context === '{}' ? 'nothing more' : slot.context}</code>
                            {slot.doc !== null && (
                                <p>
                                    <InlineDoc text={slot.doc} />
                                </p>
                            )}
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}
