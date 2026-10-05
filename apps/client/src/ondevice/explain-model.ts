const MAX_LINES = 80;
const MAX_STATEMENT_LINES = 12;

/* The keywords and shapes that make a signature one of a function or method, in the languages the servers cover. */
const FUNCTION_LIKE = /\b(?:function|def|fn|func|fun|sub|method|constructor|init)\b|=>|\)\s*(?::|->)\s*\S/;

/* Whether a hover's signature is a function or a method, which is what Explain is offered for. */
export function isFunctionSignature(signature: string): boolean {
    return FUNCTION_LIKE.test(signature);
}

function indentOf(line: string): number {
    return line.length - line.trimStart().length;
}

/* A line's braces without the ones inside a quoted piece of text, which is enough to find where a body ends. */
function bracesOf(line: string): { opens: number; closes: number } {
    const bare = line.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '').replace(/\/\/.*$/, '');
    return { opens: bare.split('{').length - 1, closes: bare.split('}').length - 1 };
}

/*
 * The source of the function that starts on a line: to the brace that closes its body, to the next line
 * indented no deeper for a language that goes by indentation, or to the end of a statement for an arrow
 * function with no body. Bounded, since it is read by a model with a small window.
 */
export function functionSourceAt(text: string, startLine: number): string {
    const lines = text.split('\n');
    const start = lines[startLine];
    if (start === undefined) {
        return '';
    }
    const head = lines.slice(startLine, startLine + 3).join('\n');
    if (!head.includes('{') && start.trimEnd().endsWith(':')) {
        const base = indentOf(start);
        const body: string[] = [start];
        for (let index = startLine + 1; index < lines.length && body.length < MAX_LINES; index++) {
            const line = lines[index]!;
            if (line.trim() !== '' && indentOf(line) <= base) {
                break;
            }
            body.push(line);
        }
        return body.join('\n').trimEnd();
    }
    if (!head.includes('{')) {
        const statement: string[] = [];
        for (let index = startLine; index < lines.length && statement.length < MAX_STATEMENT_LINES; index++) {
            const line = lines[index]!;
            if (line.trim() === '' && statement.length > 0) {
                break;
            }
            statement.push(line);
            if (line.trimEnd().endsWith(';')) {
                break;
            }
        }
        return statement.join('\n').trimEnd();
    }
    let depth = 0;
    let opened = false;
    const body: string[] = [];
    for (let index = startLine; index < lines.length && body.length < MAX_LINES; index++) {
        const line = lines[index]!;
        body.push(line);
        const { opens, closes } = bracesOf(line);
        depth += opens - closes;
        opened ||= opens > 0;
        if (opened && depth <= 0) {
            break;
        }
    }
    return body.join('\n').trimEnd();
}
