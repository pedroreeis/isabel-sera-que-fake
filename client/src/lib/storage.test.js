import { beforeEach, describe, expect, it } from "vitest";
import { createRequestId, storage } from "./storage.js";

describe("armazenamento local seguro", () => {
  beforeEach(() => localStorage.clear());

  it("guarda apenas perfil, reconexão, preferências e último relatório", () => {
    storage.setProfile({ username: "Isabel" });
    storage.setSession({ playerId: "p1", reconnectToken: "token" });
    storage.setPreferences({ sound: false });
    storage.setLastReport({ leaderboard: [] });

    expect(storage.getProfile()).toEqual({ username: "Isabel" });
    expect(storage.getSession()).toEqual({ playerId: "p1", reconnectToken: "token" });
    expect(storage.getPreferences()).toEqual({ sound: false });
    expect(storage.getLastReport()).toEqual({ leaderboard: [] });
    expect(Object.keys(localStorage).sort()).toEqual([
      "isabel.lastReport",
      "isabel.preferences",
      "isabel.profile",
      "isabel.session",
    ]);
  });

  it("gera identificadores diferentes para comandos idempotentes", () => {
    expect(createRequestId()).not.toBe(createRequestId());
  });
});
