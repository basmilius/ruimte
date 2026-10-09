import { z } from 'zod';

// Coordinates are one-based; endLine includes the entire last line.
export const FileLocationSchema = z
    .object({
        path: z.string().min(1),
        line: z.number().int().positive().optional(),
        column: z.number().int().positive().optional(),
        endLine: z.number().int().positive().optional()
    })
    .refine(
        ({ line, column, endLine }) => (column === undefined || line !== undefined) && (endLine === undefined || (line !== undefined && endLine >= line)),
        'A column or end line requires a start line, and the range must run forward.'
    );

export type FileLocation = z.infer<typeof FileLocationSchema>;
