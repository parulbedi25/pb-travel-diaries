/**
 * The bike used to be called طویل (Taweel). The rename to तस्कीन (Taskeen) has
 * to reach the site document that is already sitting in the database — the
 * defaults alone only cover a site that has never been saved.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { SQLITE_MIGRATIONS, migrateSqlite } from "../db/sqliteMigrations.js";

/** A database as it looked before the rename: schema v1, one saved document. */
function installedDatabase(content) {
  const db = new DatabaseSync(":memory:");
  for (const statement of SQLITE_MIGRATIONS[0].statements) db.exec(statement);
  db.exec(
    "CREATE TABLE IF NOT EXISTS pb_schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL)",
  );
  db.prepare("INSERT INTO pb_schema_migrations VALUES (1, 'initial SQLite schema')").run();
  db.prepare("INSERT INTO site_content (id, content) VALUES (1, ?)").run(content);
  return db;
}

const legacyDocument = JSON.stringify({
  sections: [
    {
      label: "The Machine (طویل / Taweel)",
      data: {
        titleHi: "طویل",
        titleB: " (Taweel) — Himalayan 450, Hanle Black.",
        namePlate: "طویل",
        namePlateEn: "Taweel",
        plateSub: "Named for the long roads out of Nangal Dam — طویل means long",
        filmCta: "Watch the Taweel film",
        gallery: [{ alt: "Close-up of Taweel's TripperDash console" }],
      },
    },
  ],
});

test("the saved site document is renamed to तस्कीन (Taskeen)", async () => {
  const db = installedDatabase(legacyDocument);
  const report = migrateSqlite(db);
  const saved = db.prepare("SELECT content FROM site_content WHERE id = 1").get().content;
  const { sections } = JSON.parse(saved);
  const machine = sections[0];

  assert.ok(report.applied.includes(2), "the rename migration runs on an older database");
  assert.equal(machine.label, "The Machine (तस्कीन / Taskeen)");
  assert.equal(machine.data.titleHi, "तस्कीन");
  assert.equal(machine.data.titleB, " (Taskeen) — Himalayan 450, Hanle Black.");
  assert.equal(machine.data.namePlate, "तस्कीन");
  assert.equal(machine.data.namePlateEn, "Taskeen");
  assert.equal(machine.data.filmCta, "Watch the Taskeen film");
  assert.equal(machine.data.gallery[0].alt, "Close-up of Taskeen's TripperDash console");
  // The name meant "long"; the replacement must not inherit the old meaning.
  assert.equal(
    machine.data.plateSub,
    "Named for the calm of the long roads out of Nangal Dam — तस्कीन means peace of mind",
  );
  assert.doesNotMatch(saved, /Taweel|طویل/, "no old name survives in the saved document");
});

test("running it twice changes nothing the second time", () => {
  const db = installedDatabase(legacyDocument);
  migrateSqlite(db);
  const once = db.prepare("SELECT content FROM site_content WHERE id = 1").get().content;
  assert.deepEqual(migrateSqlite(db).applied, []);
  assert.equal(db.prepare("SELECT content FROM site_content WHERE id = 1").get().content, once);
});
