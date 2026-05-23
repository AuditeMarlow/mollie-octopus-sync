import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export interface AvailableUpdate {
  version: string;
  currentVersion: string;
  notes: string | null;
  date: string | null;
  install: () => Promise<void>;
}

export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  const update = await check();
  if (!update) return null;
  return {
    version: update.version,
    currentVersion: update.currentVersion,
    notes: update.body ?? null,
    date: update.date ?? null,
    install: async () => {
      // downloadAndInstall handles fetch + signature verification + install.
      // relaunch is a separate call (not on Windows MSI which auto-relaunches,
      // but on most platforms we need to ask).
      await update.downloadAndInstall();
      await relaunch();
    },
  };
}
