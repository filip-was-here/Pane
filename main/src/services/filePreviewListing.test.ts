import { mkdtemp, writeFile, readFile, readdir, rm, truncate } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3-multiple-ciphers';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { listArchive, listSqlite } from './filePreviewListing';

let directory: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'pane-listing-test-')); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

it('lists SQLite tables and views without changing the source or creating sidecars', async () => {
  const path = join(directory, 'sample.sqlite');
  const database = new Database(path);
  database.exec('CREATE TABLE items (name TEXT); CREATE VIEW names AS SELECT name FROM items;');
  database.close();
  const before = await readFile(path);
  expect((await listSqlite(path)).rows).toEqual([['items', 'table'], ['names', 'view']]);
  expect(await readFile(path)).toEqual(before);
  expect(await readdir(directory)).toEqual(['sample.sqlite']);
});

it('refuses live WAL databases and oversized snapshots', async () => {
  const path = join(directory, 'sample.sqlite');
  const database = new Database(path); database.exec('CREATE TABLE items (name TEXT)'); database.close();
  await writeFile(`${path}-wal`, 'live');
  await expect(listSqlite(path)).rejects.toThrow('active WAL');
  await rm(`${path}-wal`);
  await truncate(path, 33 * 1024 * 1024);
  await expect(listSqlite(path)).rejects.toThrow('32 MiB');
});

it('lists a ZIP directory without extracting traversal names', async () => {
  const path = join(directory, 'sample.zip');
  const name = Buffer.from('../not-extracted.txt');
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt32LE(12, 24); central.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 10); end.writeUInt32LE(46 + name.length, 12);
  await writeFile(path, Buffer.concat([central, name, end]));
  expect((await listArchive(path)).rows).toEqual([['../not-extracted.txt', '12', 'File']]);
  expect(await readdir(directory)).toEqual(['sample.zip']);
});

it('lists TAR headers while skipping payload bytes', async () => {
  const path = join(directory, 'sample.tar');
  const header = Buffer.alloc(512); header.write('hello.txt'); header.write('00000000003\0', 124); header.fill(32, 148, 156);
  const checksum = header.reduce((sum, byte) => sum + byte, 0); header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148);
  await writeFile(path, Buffer.concat([header, Buffer.from('abc'), Buffer.alloc(509 + 1024)]));
  expect((await listArchive(path)).rows).toEqual([['hello.txt', '3', 'File']]);
  header[0] = 0; await writeFile(path, header);
  await expect(listArchive(path)).rejects.toThrow('checksum');
});

it.each(['bad.zip', 'bad.tar', 'bad.sqlite'])('fails clearly for malformed %s', async name => {
  const path = join(directory, name); await writeFile(path, 'bad data');
  await expect(name.endsWith('sqlite') ? listSqlite(path) : listArchive(path)).rejects.toThrow();
});

it('refuses a spilled rollback transaction without changing the database or journal', async () => {
  const path = join(directory, 'rollback.sqlite');
  const writer = new Database(path);
  try {
    writer.pragma('journal_mode = DELETE');
    writer.pragma('cache_size = 2');
    for (let index = 0; index < 100; index++) writer.exec(`CREATE TABLE committed_${index} (value TEXT)`);
    writer.exec('BEGIN IMMEDIATE');
    for (let index = 0; index < 100; index++) writer.exec(`ALTER TABLE committed_${index} RENAME TO temporary_${index}`);
    const before = await readFile(path);
    const journal = await readFile(`${path}-journal`);
    const names = await readdir(directory);
    expect(journal.length).toBeGreaterThan(0);
    await expect(listSqlite(path)).rejects.toThrow('rollback journal');
    expect(await readFile(path)).toEqual(before);
    expect(await readFile(`${path}-journal`)).toEqual(journal);
    expect(await readdir(directory)).toEqual(names);
  } finally { writer.close(); }
});

it('keeps the event loop responsive and enforces a deadline while parsing a wide SQLite schema', async () => {
  const path = join(directory, 'wide.sqlite');
  const database = new Database(path);
  database.unsafeMode(true);
  database.exec('CREATE TABLE seed (value TEXT); PRAGMA writable_schema = ON;');
  const columns = Array.from({ length: 1900 }, (_, index) => `column_${index}`).join(',');
  const insert = database.prepare("INSERT INTO sqlite_schema(type, name, tbl_name, rootpage, sql) VALUES ('table', ?, ?, 2, ?)");
  database.transaction(() => {
    for (let index = 0; index < 1200; index++) {
      const name = `wide_${index}`;
      insert.run(name, name, `CREATE TABLE ${name} (${columns})`);
    }
  })();
  database.close();
  let beats = 0;
  let previous = Date.now();
  let largestGap = 0;
  const heartbeat = setInterval(() => {
    const now = Date.now(); largestGap = Math.max(largestGap, now - previous); previous = now; beats++;
  }, 10);
  try {
    await expect(listSqlite(path, 100)).rejects.toThrow('timed out');
    expect(beats).toBeGreaterThan(1);
    expect(largestGap).toBeLessThan(500);
  } finally { clearInterval(heartbeat); }
}, 15000);
