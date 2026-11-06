/* A regular expression finds the text it was given, not a pattern made of it. */
export function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}
