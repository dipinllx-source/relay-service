'use strict'

const ITagRepository = require('./ITagRepository')

class SqliteTagRepository extends ITagRepository {
  constructor(db) {
    super()
    if (!db) {
      throw new Error('SqliteTagRepository requires a better-sqlite3 database instance')
    }
    this.db = db

    this.stmts = {
      insert: db.prepare('INSERT OR IGNORE INTO tags (name, created_at) VALUES (?, ?)'),
      delete: db.prepare('DELETE FROM tags WHERE name = ?'),
      list: db.prepare('SELECT name FROM tags ORDER BY name ASC')
    }
  }

  async addTag(name) {
    this.stmts.insert.run(name, Date.now())
  }

  async removeTag(name) {
    this.stmts.delete.run(name)
  }

  async listTags() {
    return this.stmts.list.all().map((r) => r.name)
  }
}

module.exports = SqliteTagRepository
