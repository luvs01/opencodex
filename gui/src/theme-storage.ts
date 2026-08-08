export type Theme = "light" | "dark" | "system";

const THEME_KEY = "ocx-theme";

export function readStoredTheme(storage?: Storage): Theme {
  try {
    const value = (storage ?? localStorage).getItem(THEME_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

export function writeStoredTheme(theme: Theme, storage?: Storage): void {
  try {
    const target = storage ?? localStorage;
    if (theme === "system") target.removeItem(THEME_KEY);
    else target.setItem(THEME_KEY, theme);
  } catch {
    // Theme persistence is optional when Web Storage is unavailable.
  }
}
