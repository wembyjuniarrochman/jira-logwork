import { vi, type Mock } from "vitest";

/**
 * Test utilities for mocking Tauri APIs in unit and component tests.
 *
 * Usage in a test file:
 *
 *   import { mockTauriInvoke, mockTauriStore } from "$lib/test-utils/tauriMocks";
 *
 *   const invoke = mockTauriInvoke({
 *     get_my_worklogs: () => ({ worklogs: [] }),
 *   });
 *
 *   const store = mockTauriStore({ users: {} });
 *
 * Both helpers register module mocks via `vi.mock` and return references that
 * can be used to set per-test behavior or assert call patterns.
 */

export type InvokeHandler = (args?: Record<string, unknown>) => unknown | Promise<unknown>;
export type InvokeHandlers = Record<string, InvokeHandler>;

export interface TauriInvokeMock {
  /** The mocked `invoke` function. */
  invoke: Mock;
  /** Replace handlers used by `invoke` to resolve commands. */
  setHandlers: (handlers: InvokeHandlers) => void;
  /** Reset call history and handlers. */
  reset: () => void;
}

/**
 * Mock `@tauri-apps/api/core` `invoke`. Pass a map of command-name to handler;
 * unhandled commands reject with an error mentioning the command name.
 *
 * NOTE: Call this BEFORE the module under test is imported. Vitest hoists
 * `vi.mock` to the top of the file when used at the top level, but when used
 * in a helper you must call `vi.mock` explicitly in the test file before the
 * import statements. Use the returned object to update handlers per test.
 */
export function mockTauriInvoke(handlers: InvokeHandlers = {}): TauriInvokeMock {
  let active: InvokeHandlers = { ...handlers };

  const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
    const handler = active[command];
    if (!handler) {
      throw new Error(`mockTauriInvoke: no handler registered for "${command}"`);
    }
    return handler(args);
  });

  vi.mock("@tauri-apps/api/core", () => ({
    invoke,
  }));

  return {
    invoke,
    setHandlers: (next) => {
      active = { ...next };
    },
    reset: () => {
      active = {};
      invoke.mockClear();
    },
  };
}

export interface MockStoreInstance {
  get: Mock;
  set: Mock;
  save: Mock;
  delete: Mock;
  has: Mock;
  keys: Mock;
  values: Mock;
  entries: Mock;
  length: Mock;
  load: Mock;
  reload: Mock;
  clear: Mock;
  /** The in-memory data backing this fake store. */
  __data: Record<string, unknown>;
}

export interface TauriStoreMock {
  /** The mocked `load` function from `@tauri-apps/plugin-store`. */
  load: Mock;
  /** Map of store path to backing data. */
  stores: Map<string, MockStoreInstance>;
  /** Seed data for a given store path. */
  seed: (path: string, data: Record<string, unknown>) => void;
  /** Reset all stores and call history. */
  reset: () => void;
}

function createStoreInstance(initial: Record<string, unknown>): MockStoreInstance {
  const data: Record<string, unknown> = { ...initial };

  const instance: MockStoreInstance = {
    __data: data,
    get: vi.fn(async (key: string) => data[key]),
    set: vi.fn(async (key: string, value: unknown) => {
      data[key] = value;
    }),
    save: vi.fn(async () => {}),
    delete: vi.fn(async (key: string) => {
      const had = key in data;
      delete data[key];
      return had;
    }),
    has: vi.fn(async (key: string) => key in data),
    keys: vi.fn(async () => Object.keys(data)),
    values: vi.fn(async () => Object.values(data)),
    entries: vi.fn(async () => Object.entries(data)),
    length: vi.fn(async () => Object.keys(data).length),
    load: vi.fn(async () => {}),
    reload: vi.fn(async () => {}),
    clear: vi.fn(async () => {
      for (const key of Object.keys(data)) delete data[key];
    }),
  };

  return instance;
}

/**
 * Mock `@tauri-apps/plugin-store` `load`. Each unique path returns a singleton
 * fake store backed by an in-memory object, so successive calls to
 * `load(path)` return the same instance.
 *
 * Pass an initial seed object to pre-populate the default store path's data.
 */
export function mockTauriStore(initialSeed: Record<string, unknown> = {}): TauriStoreMock {
  const stores = new Map<string, MockStoreInstance>();

  const load = vi.fn(async (path: string) => {
    let store = stores.get(path);
    if (!store) {
      store = createStoreInstance(initialSeed);
      stores.set(path, store);
    }
    return store;
  });

  vi.mock("@tauri-apps/plugin-store", () => ({
    load,
  }));

  return {
    load,
    stores,
    seed: (path, data) => {
      const existing = stores.get(path);
      if (existing) {
        for (const key of Object.keys(existing.__data)) delete existing.__data[key];
        Object.assign(existing.__data, data);
      } else {
        stores.set(path, createStoreInstance(data));
      }
    },
    reset: () => {
      stores.clear();
      load.mockClear();
    },
  };
}
