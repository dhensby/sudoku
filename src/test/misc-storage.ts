import type { StorageLike } from '../storage/storage';

/*
 * Storage doubles for the persistence tests: one with a quota, the way a
 * nearly full localStorage behaves, and one that throws on demand, the way
 * Safari with site data blocked or a privacy extension behaves.
 */

/** A memory storage that refuses writes beyond a size, and lets tests look inside. */
export interface QuotaStorage extends StorageLike {
  /** The most characters (keys plus values) it will hold. Changeable mid-test. */
  capacity: number;
  /** Characters currently held. */
  used(): number;
  /** Every key held, sorted. */
  keys(): string[];
  /** How many times `setItem` has been called, successful or not. */
  writes(): number;
}

/**
 * Like `memoryStorage`, but a write that would take the stored text past
 * `capacity` characters throws a `QuotaExceededError` DOMException and stores
 * nothing — which is exactly what browsers do. Sizes are counted in UTF-16
 * units over keys and values, as browsers count them.
 */
export function quotaStorage(capacity = Number.POSITIVE_INFINITY): QuotaStorage {
  const map = new Map<string, string>();
  let writes = 0;
  const size = (key: string, value: string | undefined): number =>
    value === undefined ? 0 : key.length + value.length;
  let used = 0;
  const storage: QuotaStorage = {
    capacity,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      writes++;
      const next = used - size(key, map.get(key)) + size(key, value);
      if (next > storage.capacity) {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      }
      map.set(key, value);
      used = next;
    },
    removeItem: (key) => {
      used -= size(key, map.get(key));
      map.delete(key);
    },
    used: () => used,
    keys: () => [...map.keys()].sort(),
    writes: () => writes,
  };
  return storage;
}

/** Which operations a `throwingStorage` should fail. */
export interface ThrowingOptions {
  get?: boolean;
  set?: boolean;
  remove?: boolean;
}

/**
 * A memory storage whose chosen operations throw a `SecurityError`, as
 * storage does when the browser has it switched off.
 */
export function throwingStorage(options: ThrowingOptions = {}): StorageLike {
  const map = new Map<string, string>();
  const fail = (): never => {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  };
  return {
    getItem: (key) => (options.get ? fail() : (map.get(key) ?? null)),
    setItem: (key, value) => {
      if (options.set) fail();
      map.set(key, value);
    },
    removeItem: (key) => {
      if (options.remove) fail();
      map.delete(key);
    },
  };
}
