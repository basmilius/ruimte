import { z } from 'zod';

export const ShellLanguageSchema = z.enum(['sh', 'bash', 'zsh']);
export type ShellLanguage = z.infer<typeof ShellLanguageSchema>;

export function shellCommandLine(code: string): string | null {
    const line = code.endsWith('\n') ? code.slice(0, -1) : code;
    // Reject invisible controls instead of silently changing what the person approved.
    if (!line.trim() || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(line) || new TextEncoder().encode(line).length > 1000) {
        return null;
    }
    // EOF can make an unfinished heredoc or logical list pass a shell's syntax-only mode.
    if (line.trimStart().startsWith('#') || /(^|[^<])<<([^<]|$)/.test(line) || /(?:&&|\|\|?)[ ]*$/.test(line) || /(?<!\\)(?:\\\\)*\\$/.test(line)) {
        return null;
    }
    return line;
}

export const TerminalPrepareSourceSchema = z.object({
    chatId: z.string().min(1),
    itemId: z.string().min(1),
    language: ShellLanguageSchema,
    code: z
        .string()
        .max(1001)
        .refine((code) => shellCommandLine(code) !== null, 'Expected one visible shell command line')
});
export type TerminalPrepareSource = z.infer<typeof TerminalPrepareSourceSchema>;

export const TerminalPreparePreviewPayloadSchema = TerminalPrepareSourceSchema.extend({ machineId: z.string().min(1) });
export const TerminalPrepareTargetSchema = z.object({
    token: z.string().min(1),
    sessionId: z.string().min(1),
    title: z.string(),
    cwd: z.string().min(1)
});
export type TerminalPrepareTarget = z.infer<typeof TerminalPrepareTargetSchema>;
export const TerminalPreparePreviewResultSchema = z.object({
    machineId: z.string().min(1),
    machine: z.string().min(1),
    command: z.string(),
    cwd: z.string().min(1),
    targets: z.array(TerminalPrepareTargetSchema)
});
export type TerminalPreparePreview = z.infer<typeof TerminalPreparePreviewResultSchema>;
export const TerminalPreparePayloadSchema = z.object({ machineId: z.string().min(1), token: z.string().min(1) });
export const TerminalPrepareResultSchema = z.object({ sessionId: z.string().min(1) });
