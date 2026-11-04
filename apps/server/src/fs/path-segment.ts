/* Whether a value can be one name in a path: an id from the wire that becomes a folder or file name must pass this first. */
export function isPathSegment(value: string): boolean {
    return value !== '' && value !== '.' && value !== '..' && !/[/\\\0]/.test(value) && !value.includes('..');
}
