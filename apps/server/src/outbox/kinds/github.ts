import { z } from 'zod';
import { defineOutboxKind } from '../kind.ts';

const DeliverPrWatchSchema = z.object({
    kind: z.literal('deliver-pr-watch'),
    // The target is the watching chat; the text and label are what the poll found, written when it did.
    payload: z.object({ watchId: z.string().min(1), key: z.string().min(1), text: z.string(), label: z.string() })
});

export const deliverPrWatchKind = defineOutboxKind(DeliverPrWatchSchema, {
    parked: { text: (entry, title, reason) => `The machine could not hand ${title} (${entry.target}) the news of its pull request watch: ${reason}` }
});
