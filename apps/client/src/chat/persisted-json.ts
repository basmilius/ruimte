export interface PersistedJson<T> {
    read(): T;
    /* False when storage refused; the caller keeps the value for this session either way. */
    write(value: T): boolean;
}

/*
 * A value the browser keeps between sessions. Storage that refuses, and a record written by a
 * version that shaped it differently, both come back as the fallback rather than as an error: there
 * is nothing a person could do about either, and the composer has to open regardless.
 */
export const persistedJson = <T>(key: string, parse: (raw: string | null) => T, fallback: T): PersistedJson<T> => ({
    read: () => {
        try {
            return parse(localStorage.getItem(key));
        } catch {
            return fallback;
        }
    },
    write: (value) => {
        try {
            localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch {
            return false;
        }
    }
});
