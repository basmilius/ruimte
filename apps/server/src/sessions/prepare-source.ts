import { shellCommandLine, type ChatItem, type TerminalPrepareSource } from '@ruimte/contracts';

/*
 * Only a closed top-level fence of the finished main reply can authorize a preview. Quotes, nested
 * fences and subagent text deliberately do not establish an owner here.
 */
export function hasPrepareSource(item: ChatItem | undefined, source: TerminalPrepareSource): boolean {
    if (item?.kind !== 'assistant' || item.streaming || item.parentToolUseId || item.id !== source.itemId) {
        return false;
    }
    let fence: { marker: string; length: number; language: string; lines: string[] } | null = null;
    for (const line of item.text.split('\n')) {
        if (fence === null) {
            const open = /^ {0,3}(`{3,}|~{3,})([^`]*)$/.exec(line);
            if (open) {
                fence = { marker: open[1]![0]!, length: open[1]!.length, language: open[2]!.trim(), lines: [] };
            }
        } else {
            const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
            if (close && close[1]![0] === fence.marker && close[1]!.length >= fence.length) {
                if (fence.language === source.language && fence.lines.length === 1 && fence.lines[0] === shellCommandLine(source.code)) {
                    return true;
                }
                fence = null;
            } else {
                fence.lines.push(line);
            }
        }
    }
    return false;
}
