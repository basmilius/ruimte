import { SlotList } from '@/components/docs/SlotList';
import reference from '@/generated/reference.json';
import { slotsOf, type ReferenceModule } from '@/lib/docs/reference';

/* Every slot and what it tells besides the base context, read on the server from `SlotContexts`, so the list never trails the types. */
export function SlotTable() {
    const client = (reference as ReferenceModule[]).find((module) => module.module === 'client');

    return <SlotList slots={slotsOf(client?.entries ?? [])} />;
}
