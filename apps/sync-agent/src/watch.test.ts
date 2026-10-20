import { existsSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { beforeEach, describe, expect, it } from "vitest";
import { AgentApi, type FetchLike, type SyncBatchPayload } from "./api";
import { LocalStore } from "./store";
import { scanWatchFolder } from "./watch";

const received: SyncBatchPayload[] = [];
const fetchImpl: FetchLike = async (_url, init) => {
  received.push(JSON.parse(gunzipSync(Buffer.from(init!.body as Uint8Array)).toString("utf8")));
  return Response.json({ created: 1, updated: 0, errors: 0 });
};
const api = new AgentApi("https://app.test", "sa_live_x", fetchImpl);
const now = new Date("2026-10-19T02:00:00Z");
const rules = [{ pattern: "clients*.csv", entity: "customers" as const }];

/** Export « à la française » d'un ancien logiciel : Windows-1252, séparateur « ; ». */
function writeExport(dir: string, name: string, ageSeconds = 120, content?: Buffer) {
  const csv =
    content ??
    Buffer.from(
      "Nom & Prénoms;Tél.\r\nKouassi Jean-Marc;0747218890\r\nSOTRA Logistique;0505112233\r\n",
      "latin1",
    );
  const file = path.join(dir, name);
  writeFileSync(file, csv);
  const t = new Date(now.getTime() - ageSeconds * 1000);
  utimesSync(file, t, t);
  return file;
}

describe("dossier surveillé de l'agent (RG-M13-29)", () => {
  let watchDir: string;
  let store: LocalStore;
  beforeEach(() => {
    received.length = 0;
    watchDir = mkdtempSync(path.join(tmpdir(), "watch-"));
    store = new LocalStore(mkdtempSync(path.join(tmpdir(), "agent-")));
  });

  it("lit un export Windows-1252, envoie ses lignes et le range dans traites/AAAA-MM-JJ", async () => {
    writeExport(watchDir, "clients_2026-10-18.csv");
    writeExport(watchDir, "notes.txt"); // aucun motif : ignoré et laissé en place
    const result = await scanWatchFolder({
      api,
      store,
      watchDir,
      rules,
      now,
      localDay: "2026-10-19",
    });
    expect(result.processed).toEqual(["clients_2026-10-18.csv"]);
    expect(received).toEqual([
      {
        entity: "customers",
        columns: ["Nom & Prénoms", "Tél."],
        rows: [
          ["Kouassi Jean-Marc", "0747218890"],
          ["SOTRA Logistique", "0505112233"],
        ],
      },
    ]);
    expect(existsSync(path.join(watchDir, "traites/2026-10-19/clients_2026-10-18.csv"))).toBe(true);
    expect(existsSync(path.join(watchDir, "notes.txt"))).toBe(true);
  });

  it("attend qu'un fichier soit stable depuis 60 s et ignore un fichier déjà traité", async () => {
    writeExport(watchDir, "clients_a.csv", 10);
    let result = await scanWatchFolder({
      api,
      store,
      watchDir,
      rules,
      now,
      localDay: "2026-10-19",
    });
    expect(result.skipped).toEqual(["clients_a.csv"]);
    expect(received).toHaveLength(0);

    writeExport(watchDir, "clients_a.csv", 120);
    await scanWatchFolder({ api, store, watchDir, rules, now, localDay: "2026-10-19" });
    expect(received).toHaveLength(1);

    writeExport(watchDir, "clients_copie.csv", 120); // même contenu : même sha256
    result = await scanWatchFolder({ api, store, watchDir, rules, now, localDay: "2026-10-19" });
    expect(result.skipped).toEqual(["clients_copie.csv"]);
    expect(received).toHaveLength(1);
    expect(existsSync(path.join(watchDir, "traites/2026-10-19/clients_copie.csv"))).toBe(true);
  });

  it("n'envoie que les lignes changées d'un export complet quotidien", async () => {
    writeExport(watchDir, "clients_j1.csv");
    await scanWatchFolder({ api, store, watchDir, rules, now, localDay: "2026-10-19" });
    writeExport(
      watchDir,
      "clients_j2.csv",
      120,
      Buffer.from(
        "Nom & Prénoms;Tél.\r\nKouassi Jean-Marc;0747218890\r\nSOTRA Logistique;0101010101\r\n",
        "latin1",
      ),
    );
    await scanWatchFolder({ api, store, watchDir, rules, now, localDay: "2026-10-19" });
    expect(received[1]!.rows).toEqual([["SOTRA Logistique", "0101010101"]]);
  });

  it("range un fichier illisible dans erreurs/", async () => {
    const xlsxRules = [{ pattern: "*.xlsx", entity: "customers" as const }];
    writeExport(watchDir, "clients.xlsx", 120, Buffer.from("pas un classeur"));
    const result = await scanWatchFolder({
      api,
      store,
      watchDir,
      rules: xlsxRules,
      now,
      localDay: "2026-10-19",
    });
    expect(result.failed.map((f) => f.file)).toEqual(["clients.xlsx"]);
    expect(existsSync(path.join(watchDir, "erreurs/clients.xlsx"))).toBe(true);
  });
});
