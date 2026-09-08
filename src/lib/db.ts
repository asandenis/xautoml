const DB_NAME = 'xautoml'
const DB_VERSION = 2

export const STORES = {
  accounts: 'accounts',
  uploads: 'uploads',
  runs: 'runs',
  googleKeys: 'googleKeys',
} as const

export function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = (event) => {
      const db = request.result
      const oldVersion = event.oldVersion

      if (!db.objectStoreNames.contains(STORES.accounts)) {
        db.createObjectStore(STORES.accounts, { keyPath: 'id' })
      }

      if (oldVersion < 2) {
        if (db.objectStoreNames.contains(STORES.uploads)) {
          db.deleteObjectStore(STORES.uploads)
        }
        const uploads = db.createObjectStore(STORES.uploads, { keyPath: 'id' })
        uploads.createIndex('byUser', 'userId', { unique: false })
      } else if (!db.objectStoreNames.contains(STORES.uploads)) {
        const uploads = db.createObjectStore(STORES.uploads, { keyPath: 'id' })
        uploads.createIndex('byUser', 'userId', { unique: false })
      }

      if (!db.objectStoreNames.contains(STORES.runs)) {
        const runs = db.createObjectStore(STORES.runs, { keyPath: 'id' })
        runs.createIndex('byUser', 'userId', { unique: false })
      }

      if (!db.objectStoreNames.contains(STORES.googleKeys)) {
        db.createObjectStore(STORES.googleKeys, { keyPath: 'userId' })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB'))
  })
}

export function reqToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

export function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
  })
}
