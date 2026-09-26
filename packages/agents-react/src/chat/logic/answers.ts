/* The choices a person picked, per question id, held as a list until they go over the wire. */
export type PickedAnswers = Record<string, string[]>;

/* The separator between several choices of one question, once they are one string. */
const SEPARATOR = ', ';

/*
 * Add or remove one choice of a multi select question. The picks stay a list here because a label
 * may hold the separator itself: joined too early, such a label no longer matches itself and the
 * choice would read as unpicked on screen.
 */
export function toggleChoice(picked: string[], label: string): string[] {
    return picked.includes(label) ? picked.filter((choice) => choice !== label) : [...picked, label];
}

/* The wire takes one string per question, so several choices travel as one line. */
export function answersToWire(picked: PickedAnswers): Record<string, string> {
    return Object.fromEntries(Object.entries(picked).map(([id, labels]) => [id, labels.join(SEPARATOR)]));
}
