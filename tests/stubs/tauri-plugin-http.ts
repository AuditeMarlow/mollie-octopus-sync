// Stub for `@tauri-apps/plugin-http`, aliased in by vitest.config.ts.
//
// Our unit tests cover the pure helpers in mollie.ts / emailoctopus.ts
// (detectMode, extractErrorMessage, isDuplicateError). The HTTP fns
// transitively import this module but tests don't call them — this stub
// makes the import resolve in a Node environment without dragging in the
// real plugin's Tauri-IPC machinery.

export function fetch(): never {
  throw new Error(
    "HTTP fetch is not available in unit tests; mock the calling fn instead.",
  );
}
