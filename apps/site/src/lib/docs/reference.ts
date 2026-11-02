export interface ReferenceEntry {
    name: string;
    kind: 'function' | 'const' | 'interface' | 'type' | 'export';
    doc: string | null;
    code: string;
}

export interface ReferenceModule {
    module: string;
    entries: ReferenceEntry[];
}

const DECLARATION = /^(?:export\s+)?(?:declare\s+)?(function|const|interface|type)\s+(\w+)/;
const REEXPORT = /^export\s+\*\s+from\s+'([^']+)'/;

function docText(lines: readonly string[]): string {
    return lines
        .join('\n')
        .replace(/^\s*\/\*\*\s?/, '')
        .replace(/\s*\*\/\s*$/, '')
        .split('\n')
        .map((line) => line.replace(/^\s*\*\s?/, ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/* A comment line holds words, not code, so its brackets never close a declaration. */
function depthChange(line: string): number {
    const trimmed = line.trim();

    if (trimmed.startsWith('/*') || trimmed.startsWith('*') || trimmed.startsWith('//')) {
        return 0;
    }

    let change = 0;

    for (const char of line.replace(/'[^']*'/g, '')) {
        if (char === '{' || char === '(' || char === '[') {
            change += 1;
        } else if (char === '}' || char === ')' || char === ']') {
            change -= 1;
        }
    }

    return change;
}

function entryOf(statement: readonly string[], doc: string | null): ReferenceEntry | null {
    const first = statement[0]?.trim() ?? '';
    const reexport = REEXPORT.exec(first);

    if (reexport !== null) {
        return { name: reexport[1] ?? '', kind: 'export', doc, code: first };
    }

    const declaration = DECLARATION.exec(first);

    if (declaration === null) {
        return null;
    }

    return { name: declaration[2] ?? '', kind: declaration[1] as ReferenceEntry['kind'], doc, code: statement.join('\n') };
}

/* Every top-level declaration of a `.d.ts`, with the doc comment above it. Overloads of one name become one entry. */
export function parseDeclarations(source: string): ReferenceEntry[] {
    const entries: ReferenceEntry[] = [];
    let doc: string[] = [];
    let inDoc = false;
    let statement: string[] = [];
    let depth = 0;

    for (const line of source.split('\n')) {
        const trimmed = line.trim();

        if (statement.length === 0) {
            if (inDoc || trimmed.startsWith('/**')) {
                if (!inDoc) {
                    doc = [];
                }

                doc.push(line);
                inDoc = !trimmed.endsWith('*/');
                continue;
            }

            if (trimmed === '' || trimmed.startsWith('import ')) {
                continue;
            }
        }

        statement.push(line);
        depth += depthChange(line);

        if (depth === 0 && (trimmed.endsWith(';') || trimmed.endsWith('}'))) {
            const entry = entryOf(statement, doc.length === 0 ? null : docText(doc));
            const previous = entries.at(-1);

            if (entry !== null && previous !== undefined && previous.name === entry.name && previous.kind === entry.kind) {
                previous.code = `${previous.code}\n${entry.code}`;
                previous.doc ??= entry.doc;
            } else if (entry !== null) {
                entries.push(entry);
            }

            statement = [];
            doc = [];
        }
    }

    return entries;
}

/* What each slot tells, read off `SlotContexts`, so the table of slots follows the types. */
export function slotsOf(entries: readonly ReferenceEntry[]): { name: string; context: string; doc: string | null }[] {
    const contexts = entries.find((entry) => entry.name === 'SlotContexts');

    if (contexts === undefined) {
        return [];
    }

    const slots: { name: string; context: string; doc: string | null }[] = [];
    let doc: string | null = null;

    for (const line of contexts.code.split('\n').slice(1, -1)) {
        const trimmed = line.trim();
        const doced = /^\/\*\*\s*(.*?)\s*\*\/$/.exec(trimmed);

        if (doced !== null) {
            doc = doced[1] ?? null;
            continue;
        }

        const member = /^(\w+):\s*(.*);$/.exec(trimmed);

        if (member !== null) {
            slots.push({ name: member[1] ?? '', context: member[2] ?? '', doc });
            doc = null;
        }
    }

    return slots;
}
