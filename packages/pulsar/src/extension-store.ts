import { z } from 'zod';

/*
 * The public half of the key that signs `index.json` in `ruimte-app/extensions`. Empty until that key
 * exists, and a Ruimte with no key shows no store rather than an unverified one. See docs/EXTENSIONS.md.
 */
export const EXTENSION_STORE_PUBLIC_KEY = '';

export const ExtensionStoreEntrySchema = z.object({
    id: z.string(),
    name: z.string(),
    version: z.string(),
    description: z.string().optional(),
    publisher: z.string().optional(),
    category: z.string().optional(),
    color: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .optional(),
    // A path in the store, like `path`.
    icon: z.string().optional(),
    reviewedAt: z.string().optional(),
    permissions: z.record(z.string(), z.string()).optional(),
    path: z.string(),
    sha256: z.string()
});
export type ExtensionStoreEntry = z.infer<typeof ExtensionStoreEntrySchema>;

export const ExtensionStoreIndexSchema = z.object({ extensions: z.array(ExtensionStoreEntrySchema) });
