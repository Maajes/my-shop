import express from 'express';
import cors from 'cors';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));
app.use('/images', express.static(path.join(__dirname, 'images')));

// 初始化数据库
let db;

(async () => {
  try {
    db = await open({
      filename: 'shop.db',
      driver: sqlite3.Database
    });

    // 创建数据表
    await db.exec(`
      CREATE TABLE IF NOT EXISTS items (
        id TEXT PRIMARY KEY,
        name TEXT,
        description TEXT,
        condition TEXT,
        priceType TEXT,
        price REAL,
        image TEXT,
        claimed INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS visitors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nickname TEXT,
        gender TEXT,
        campus TEXT,
        studentId TEXT UNIQUE,
        qq TEXT,
        ip TEXT,
        firstAccess TEXT,
        lastAccess TEXT
      );

      CREATE TABLE IF NOT EXISTS claims (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        studentId TEXT,
        itemId TEXT,
        claimTime TEXT
      );
    `);

    console.log('Database connected successfully');
  } catch (error) {
    console.error('Database initialization error:', error);
  }
})();

// API 路由
app.get('/api/items', async (req, res) => {
  try {
    const items = await db.all('SELECT * FROM items');
    res.json(items);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/visitor/register', async (req, res) => {
  try {
    const { nickname, gender, campus, studentId, qq, ip } = req.body;
    const now = new Date().toLocaleString();
    
    await db.run(
      `INSERT OR REPLACE INTO visitors (nickname, gender, campus, studentId, qq, ip, firstAccess, lastAccess)
       VALUES (?, ?, ?, ?, ?, ?, COALESCE((SELECT firstAccess FROM visitors WHERE studentId = ?), ?), ?)`,
      [nickname, gender, campus, studentId, qq, ip, studentId, now, now]
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/claims/:studentId', async (req, res) => {
  try {
    const claims = await db.all('SELECT itemId FROM claims WHERE studentId = ?', req.params.studentId);
    res.json(claims.map(c => c.itemId));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/claims/submit', async (req, res) => {
  const { studentId, itemIds } = req.body;
  const now = new Date().toLocaleString();
  
  try {
    await db.run('BEGIN TRANSACTION');
    
    for (const itemId of itemIds) {
      const result = await db.run('UPDATE items SET claimed = 1 WHERE id = ? AND claimed = 0', itemId);
      if (result.changes === 0) {
        throw new Error(`物品已被申领`);
      }
      await db.run('INSERT INTO claims (studentId, itemId, claimTime) VALUES (?, ?, ?)', 
        [studentId, itemId, now]);
    }
    
    await db.run('COMMIT');
    res.json({ success: true });
  } catch (error) {
    await db.run('ROLLBACK');
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/visitors/all', async (req, res) => {
  try {
    const visitors = await db.all(`
      SELECT v.*, GROUP_CONCAT(c.itemId) as claimedItems
      FROM visitors v
      LEFT JOIN claims c ON v.studentId = c.studentId
      GROUP BY v.studentId
    `);
    res.json(visitors);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/seller/verify', (req, res) => {
  const { birthday } = req.body;
  res.json({ success: birthday === '2004-10-22' });
});

// 所有其他请求返回 index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
