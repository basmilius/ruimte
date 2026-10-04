/* A plain object, which is what a tool's input and a stored record are and an array is not. */
export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
