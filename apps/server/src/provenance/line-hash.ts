import { createHash } from 'node:crypto';

/* Forty bits per line: a collision inside one file would need two different lines to meet in the same diff. */
const HASH_LENGTH = 10;

export function hashLine(line: string): string {
    return createHash('sha1').update(line).digest('hex').slice(0, HASH_LENGTH);
}

export function hashLines(lines: readonly string[]): string[] {
    return lines.map(hashLine);
}

export function sameLines(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length && left.every((line, index) => line === right[index]);
}
