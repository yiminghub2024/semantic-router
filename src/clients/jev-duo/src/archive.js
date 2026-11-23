import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export class Archive {
  constructor(directory) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(join(directory, 'history.sqlite'));
    this.db.exec(`
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS turns (
        session TEXT NOT NULL, seq INTEGER NOT NULL, prompt TEXT NOT NULL,
        reply TEXT NOT NULL, backend TEXT NOT NULL, model TEXT NOT NULL,
        attachments TEXT NOT NULL, PRIMARY KEY(session, seq)
      );
      CREATE TABLE IF NOT EXISTS blobs (digest TEXT PRIMARY KEY, data BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS routing (
        session TEXT NOT NULL, seq INTEGER NOT NULL, decision TEXT, trace TEXT,
        PRIMARY KEY(session, seq)
      );
    `);
  }

  sessions() {
    return this.db.prepare(`SELECT session FROM turns GROUP BY session
      ORDER BY MAX(rowid) DESC`).all().map(row => row.session);
  }

  history(session) {
    return this.db
      .prepare(
        `SELECT seq,prompt,reply,backend,model,attachments,routing.decision,routing.trace,
          routing.seq IS NOT NULL AS hasRouting FROM turns LEFT JOIN routing USING(session,seq)
      WHERE session=? ORDER BY seq DESC LIMIT 64`,
      )
      .all(session)
      .reverse()
      .map((row) => ({ ...row, attachments: JSON.parse(row.attachments) }));
  }

  append({ session, seq, prompt, reply, backend, model, media, routing }) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const latest = this.db
        .prepare('SELECT MAX(seq) AS n FROM turns WHERE session=?')
        .get(session);
      if (seq !== (latest.n ?? 0) + 1)
        throw new Error(
          'Conversation changed during inference. Submit again to use the latest history.',
        );
      const insert = this.db.prepare(
        'INSERT OR IGNORE INTO blobs VALUES (?,?)',
      );
      for (const file of media) insert.run(file.digest, file.bytes);
      const refs = media.map(({ digest, mime, kind }) => ({
        digest,
        mime,
        kind,
      }));
      this.db
        .prepare('INSERT INTO turns VALUES (?,?,?,?,?,?,?)')
        .run(session, seq, prompt, reply, backend, model, JSON.stringify(refs));
      if (routing) this.db.prepare('INSERT INTO routing VALUES (?,?,?,?)')
        .run(session, seq, routing.decision, routing.trace);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  close() {
    this.db.close();
  }
}
