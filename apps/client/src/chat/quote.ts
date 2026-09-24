/*
 * The text a selection in an answer quotes: its lines without trailing spaces or the blank lines
 * around them, and at most one blank line in a row. A selection of only whitespace quotes nothing.
 */
export const quoteOf = (selected: string): string | null => {
    const text = selected
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map((line) => line.replace(/\s+$/, ''))
        .join('\n')
        .replace(/^\n+|\n+$/g, '')
        .replace(/\n{3,}/g, '\n\n');
    return text.trim() === '' ? null : text;
};

/* The message as it goes out: the quote as a markdown blockquote, a blank line, then what was typed. */
export const withQuote = (quote: string, message: string): string => {
    if (quote === '') {
        return message;
    }
    const block = quote
        .split('\n')
        .map((line) => (line === '' ? '>' : `> ${line}`))
        .join('\n');
    return message === '' ? block : `${block}\n\n${message}`;
};
