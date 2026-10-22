export interface KeyValueStore {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
  clear(): Promise<void>;
}

export class MemoryStore implements KeyValueStore {
  private map = new Map<string, unknown>();
  async get<T = unknown>(key: string): Promise<T | undefined> {
    return this.map.has(key) ? (structuredClone(this.map.get(key)) as T) : undefined;
  }
  async set(key: string, value: unknown): Promise<void> { this.map.set(key, structuredClone(value)); }
  async delete(key: string): Promise<void> { this.map.delete(key); }
  async keys(): Promise<string[]> { return [...this.map.keys()]; }
  async clear(): Promise<void> { this.map.clear(); }
}

const DB_NAME = 'decluttering';
const STORE_NAME = 'cache';

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Thin raw-IndexedDB adapter; one database, one object store. */
export class IndexedDbStore implements KeyValueStore {
  private db: Promise<IDBDatabase> | null = null;

  constructor(private factory: IDBFactory = indexedDB) {}

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise((resolve, reject) => {
      const req = this.factory.open(DB_NAME, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore(STORE_NAME); };
      req.onsuccess = () => {
        const db = req.result;
        // "Sign out and clear saved data" deletes this database; an open connection would block that until the page
        // reloads. Close on request; the next read or write opens a fresh (empty) database.
        db.onversionchange = () => { db.close(); this.db = null; };
        resolve(db);
      };
      req.onerror = () => reject(req.error);
    });
    return this.db;
  }

  private async store(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    return (await this.open()).transaction(STORE_NAME, mode).objectStore(STORE_NAME);
  }

  async get<T = unknown>(key: string): Promise<T | undefined> {
    return (await wrap((await this.store('readonly')).get(key))) as T | undefined;
  }
  async set(key: string, value: unknown): Promise<void> { await wrap((await this.store('readwrite')).put(value, key)); }
  async delete(key: string): Promise<void> { await wrap((await this.store('readwrite')).delete(key)); }
  async keys(): Promise<string[]> { return (await wrap((await this.store('readonly')).getAllKeys())).map(String); }
  async clear(): Promise<void> { await wrap((await this.store('readwrite')).clear()); }
}
