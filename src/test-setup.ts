import "@testing-library/jest-dom/vitest";
import { vi, afterEach } from "vitest";

/**
 * Global stub for `window.matchMedia`, used by components that respect
 * `prefers-reduced-motion`. Defaults to "no preference" (motion enabled).
 *
 * Tests can override the implementation via `vi.spyOn` if they need to
 * simulate a user with reduced-motion enabled.
 */
function createMatchMediaStub(matches = false): typeof window.matchMedia {
  return (query: string): MediaQueryList => {
    const list: MediaQueryList = {
      matches: query.includes("prefers-reduced-motion: reduce") ? matches : false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
    return list;
  };
}

if (typeof window !== "undefined") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn(createMatchMediaStub(false)),
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});
