import { invoke } from "@tauri-apps/api/core";
import {
  disable as autostartDisable,
  enable as autostartEnable,
  isEnabled as autostartIsEnabled,
} from "@tauri-apps/plugin-autostart";
import type { AppConfig, Credentials } from "../types";

export function getCredentials(): Promise<Credentials> {
  return invoke<Credentials>("get_credentials");
}

export function setCredentials(creds: Credentials): Promise<void> {
  return invoke<void>("set_credentials", { credentials: creds });
}

export function clearCredentials(): Promise<void> {
  return invoke<void>("clear_credentials");
}

export function hasCredentials(): Promise<boolean> {
  return invoke<boolean>("has_credentials");
}

export function loadConfig(): Promise<AppConfig> {
  return invoke<AppConfig>("load_config");
}

export function saveConfig(config: AppConfig): Promise<void> {
  return invoke<void>("save_config", { config });
}

export function openLogsFolder(): Promise<void> {
  return invoke<void>("open_logs_folder");
}

export function appDataDir(): Promise<string> {
  return invoke<string>("app_data_dir");
}

export async function logLine(level: string, message: string): Promise<void> {
  try {
    await invoke<void>("log_line", { level, message });
  } catch {
    // Logging is best-effort. Never let log failures break a sync.
  }
}

export function showMainWindow(): Promise<void> {
  return invoke<void>("show_main_window");
}

export async function isAutostartEnabled(): Promise<boolean> {
  try {
    return await autostartIsEnabled();
  } catch {
    return false;
  }
}

export function enableAutostart(): Promise<void> {
  return autostartEnable();
}

export function disableAutostart(): Promise<void> {
  return autostartDisable();
}
