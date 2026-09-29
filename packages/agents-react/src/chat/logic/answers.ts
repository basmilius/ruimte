/*
 * Add or remove one choice of a multi select question. The picks stay a list here because a label
 * may hold the separator itself: joined too early, such a label no longer matches itself and the
 * choice would read as unpicked on screen.
 */
export function toggleChoice(picked: string[], label: string): string[] {
    return picked.includes(label) ? picked.filter((choice) => choice !== label) : [...picked, label];
}
