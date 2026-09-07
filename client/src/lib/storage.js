const KEYS = {
  profile: "isabel.profile",
  session: "isabel.session",
  preferences: "isabel.preferences",
  report: "isabel.lastReport",
};

function read(key, fallback = null) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // The game remains usable when private browsing blocks storage.
  }
}

export const storage = {
  getProfile: () => read(KEYS.profile, { username: "" }),
  setProfile: (profile) => write(KEYS.profile, profile),
  getSession: () => read(KEYS.session),
  setSession: (session) => write(KEYS.session, session),
  clearSession: () => localStorage.removeItem(KEYS.session),
  getPreferences: () => read(KEYS.preferences, { sound: false }),
  setPreferences: (preferences) => write(KEYS.preferences, preferences),
  getLastReport: () => read(KEYS.report),
  setLastReport: (report) => write(KEYS.report, report),
};

export function createRequestId() {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
