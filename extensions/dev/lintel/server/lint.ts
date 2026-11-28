import type { Problem } from '@ruimte/extension/server';
import { RULES } from './service';

// What Ruimte takes of one file; a file with more is cut here, so its first problems still show.
export const MAX_PROBLEMS_PER_FILE = 200;

/* What the rules find in the text of one file, in the order of its lines. */
export function problemsIn(text: string): Problem[] {
    const problems: Problem[] = [];

    text.split(/\r?\n/).forEach((line, index) => {
        for (const rule of RULES) {
            const found = rule.find(line);

            if (found !== null) {
                problems.push({
                    line: index + 1,
                    column: found.column,
                    endLine: index + 1,
                    endColumn: found.column + found.length,
                    severity: rule.severity,
                    message: rule.message(line),
                    code: rule.code
                });
            }
        }
    });

    return problems.slice(0, MAX_PROBLEMS_PER_FILE);
}
