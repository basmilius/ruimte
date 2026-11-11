/*
 * A word a machine sent from an open vocabulary, when this version knows it; null for one of a newer machine. Where a
 * word decides something, such as an action's output or a label, the unknown one is never read as one of these.
 */
export function knownWord<Word extends string>(known: readonly Word[], word: string | null | undefined): Word | null {
    return typeof word === 'string' && (known as readonly string[]).includes(word) ? (word as Word) : null;
}
