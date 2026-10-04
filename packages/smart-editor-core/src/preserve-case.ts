const letter = /\p{L}/u;
const upper = /\p{Lu}/u;
const lower = /\p{Ll}/u;

/*
 * Gives a replacement the case of the text it replaces: the first letter follows the first letter of
 * the match, and the rest follows the tail of the match when that is all upper or all lower case and
 * the replacement's own tail is not already the other way. The platform's "Preserve case" for a replace.
 */
export function replaceWithCaseRespect(replacement: string, found: string): string {
    if (found === '' || replacement === '') {
        return replacement;
    }
    const [firstFound] = found;
    const [firstReplacement] = replacement;
    const head = upper.test(firstFound!) ? firstReplacement!.toUpperCase() : firstReplacement!.toLowerCase();
    const replacementTail = replacement.slice(firstReplacement!.length);
    if (replacementTail === '') {
        return head;
    }
    const foundTail = found.slice(firstFound!.length);
    if (foundTail === '') {
        return head + replacementTail;
    }
    let replacementLower = true;
    let replacementUpper = true;
    for (const character of replacementTail) {
        if (!letter.test(character)) {
            continue;
        }
        replacementLower &&= lower.test(character);
        replacementUpper &&= upper.test(character);
        if (!replacementLower && !replacementUpper) {
            break;
        }
    }
    let tailUpper = true;
    let tailLower = true;
    let tailChecked = false;
    for (const character of foundTail) {
        if (!letter.test(character)) {
            continue;
        }
        tailUpper &&= upper.test(character);
        tailLower &&= lower.test(character);
        tailChecked = true;
        if (!tailUpper && !tailLower) {
            break;
        }
    }
    if (!tailChecked) {
        tailUpper = letter.test(firstFound!) && upper.test(firstFound!);
        tailLower = letter.test(firstFound!) && lower.test(firstFound!);
    }
    if (tailUpper && (replacementLower || !replacementUpper)) {
        return head + replacementTail.toUpperCase();
    }
    if (tailLower && (replacementLower || replacementUpper)) {
        return head + replacementTail.toLowerCase();
    }
    return head + replacementTail;
}
