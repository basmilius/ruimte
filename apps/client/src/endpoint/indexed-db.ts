import i18next from 'i18next';

export type ObjectStoreRunner = <T>(mode: IDBTransactionMode, act: (store: IDBObjectStore) => IDBRequest<T>) => Promise<T>;

/* Runs one request against a single object store, opening (and on first use creating) its database each time. */
export function objectStoreRunner(dbName: string, storeName: string): ObjectStoreRunner {
    const open = (): Promise<IDBDatabase> =>
        new Promise((resolve, reject) => {
            const request = indexedDB.open(dbName, 1);
            request.onupgradeneeded = () => request.result.createObjectStore(storeName);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error ?? new Error(i18next.t('machines:storage.indexedDbClosed')));
        });

    return <T>(mode: IDBTransactionMode, act: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> =>
        open().then(
            (db) =>
                new Promise<T>((resolve, reject) => {
                    const request = act(db.transaction(storeName, mode).objectStore(storeName));
                    request.onsuccess = () => resolve(request.result);
                    request.onerror = () => reject(request.error ?? new Error(i18next.t('machines:storage.indexedDbRefused')));
                })
        );
}
