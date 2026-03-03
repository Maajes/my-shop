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
        claimTime TEXT,
        FOREIGN KEY (studentId) REFERENCES visitors(studentId),
        FOREIGN KEY (itemId) REFERENCES items(id)
      );

      CREATE TABLE IF NOT EXISTS ip_records (
        ip TEXT PRIMARY KEY,
        students TEXT,
        firstSeen TEXT,
        lastSeen TEXT,
        isMonitored INTEGER DEFAULT 0,
        monitoredSince TEXT
      );

      CREATE TABLE IF NOT EXISTS seller (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        nickname TEXT,
        gender TEXT,
        studentId TEXT,
        campus TEXT,
        qq TEXT,
        birthday TEXT
      );
    `);

    // 插入卖家信息
    await db.run(
      `INSERT OR REPLACE INTO seller (id, nickname, gender, studentId, campus, qq, birthday) 
       VALUES (1, 'majes', '男', '082240120', '将军路校区', '3371476457', '2004-10-22')`
    );

    console.log('Database connected successfully');
  } catch (error) {
    console.error('Database initialization error:', error);
  }
})();

// ========== API 路由 ==========

// 1. 获取所有物品
app.get('/api/items', async (req, res) => {
  try {
    const items = await db.all('SELECT * FROM items');
    res.json(items);
  } catch (error) {
    console.error('Error fetching items:', error);
    res.status(500).json({ error: error.message });
  }
});

// 2. 更新物品状态（申领状态）
app.post('/api/items/update', async (req, res) => {
  try {
    const { id, claimed } = req.body;
    console.log('Updating item:', id, 'claimed:', claimed);
    
    const result = await db.run(
      'UPDATE items SET claimed = ? WHERE id = ?',
      [claimed ? 1 : 0, id]
    );
    
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Item not found' });
    }
    
    res.json({ success: true, changes: result.changes });
  } catch (error) {
    console.error('Error updating item:', error);
    res.status(500).json({ error: error.message });
  }
});

// 3. 编辑物品信息（卖家）
app.post('/api/items/edit', async (req, res) => {
  try {
    const { id, name, description, condition, priceType, price } = req.body;
    console.log('Editing item:', id, name);
    
    const result = await db.run(
      `UPDATE items SET name = ?, description = ?, condition = ?, priceType = ?, price = ? WHERE id = ?`,
      [name, description, condition, priceType, price, id]
    );
    
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Item not found' });
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error editing item:', error);
    res.status(500).json({ error: error.message });
  }
});

// 4. 访客注册/登录
app.post('/api/visitor/register', async (req, res) => {
  try {
    const { nickname, gender, campus, studentId, qq, ip } = req.body;
    const now = new Date().toLocaleString();
    
    // 检查学号是否已被不同QQ使用
    const existing = await db.get('SELECT * FROM visitors WHERE studentId = ?', [studentId]);
    
    if (existing) {
      if (existing.qq !== qq) {
        return res.json({ error: '该学号已被其他QQ使用' });
      }
      // 更新访问时间
      await db.run(
        'UPDATE visitors SET lastAccess = ? WHERE studentId = ?',
        [now, studentId]
      );
    } else {
      // 新访客
      await db.run(
        `INSERT INTO visitors (nickname, gender, campus, studentId, qq, ip, firstAccess, lastAccess) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [nickname, gender, campus, studentId, qq, ip, now, now]
      );
    }
    
    // 更新IP记录
    await updateIPRecord(ip, studentId, now);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error registering visitor:', error);
    res.status(500).json({ error: error.message });
  }
});

// 5. 获取访客的申领记录
app.get('/api/claims/:studentId', async (req, res) => {
  try {
    const claims = await db.all(
      'SELECT itemId FROM claims WHERE studentId = ?',
      [req.params.studentId]
    );
    res.json(claims.map(c => c.itemId));
  } catch (error) {
    console.error('Error fetching claims:', error);
    res.status(500).json({ error: error.message });
  }
});

// 6. 提交申领
app.post('/api/claims/submit', async (req, res) => {
  const { studentId, itemIds } = req.body;
  const now = new Date().toLocaleString();
  
  console.log('Submitting claims:', { studentId, itemIds });
  
  try {
    await db.run('BEGIN TRANSACTION');
    
    // 检查所有物品是否都未被申领
    for (const itemId of itemIds) {
      const item = await db.get('SELECT claimed FROM items WHERE id = ?', [itemId]);
      if (!item) {
        throw new Error(`物品 ${itemId} 不存在`);
      }
      if (item.claimed === 1) {
        throw new Error(`物品 ${itemId} 已被申领`);
      }
    }
    
    // 更新物品状态
    for (const itemId of itemIds) {
      const result = await db.run(
        'UPDATE items SET claimed = 1 WHERE id = ? AND claimed = 0',
        [itemId]
      );
      if (result.changes === 0) {
        throw new Error(`物品 ${itemId} 更新失败`);
      }
    }
    
    // 记录申领
    for (const itemId of itemIds) {
      await db.run(
        'INSERT INTO claims (studentId, itemId, claimTime) VALUES (?, ?, ?)',
        [studentId, itemId, now]
      );
    }
    
    await db.run('COMMIT');
    console.log('Claims submitted successfully');
    res.json({ success: true });
  } catch (error) {
    await db.run('ROLLBACK');
    console.error('Error submitting claims:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 7. 获取所有访客记录（卖家）
app.get('/api/visitors/all', async (req, res) => {
  try {
    const visitors = await db.all(`
      SELECT v.*, GROUP_CONCAT(c.itemId) as claimedItems
      FROM visitors v
      LEFT JOIN claims c ON v.studentId = c.studentId
      GROUP BY v.studentId
      ORDER BY v.lastAccess DESC
    `);
    res.json(visitors);
  } catch (error) {
    console.error('Error fetching visitors:', error);
    res.status(500).json({ error: error.message });
  }
});

// 8. IP记录管理
async function updateIPRecord(ip, studentId, time) {
  try {
    const record = await db.get('SELECT * FROM ip_records WHERE ip = ?', [ip]);
    
    if (!record) {
      // 新IP记录
      const students = {};
      students[studentId] = time;
      await db.run(
        `INSERT INTO ip_records (ip, students, firstSeen, lastSeen, isMonitored) 
         VALUES (?, ?, ?, ?, 0)`,
        [ip, JSON.stringify(students), time, time]
      );
    } else {
      // 更新现有记录
      const students = JSON.parse(record.students || '{}');
      students[studentId] = time;
      
      // 检查是否超过阈值（2个不同学号）
      const uniqueStudents = Object.keys(students).length;
      const isMonitored = uniqueStudents > 2 ? 1 : 0;
      
      await db.run(
        `UPDATE ip_records SET students = ?, lastSeen = ?, isMonitored = ?, monitoredSince = CASE WHEN ? = 1 AND monitoredSince IS NULL THEN ? ELSE monitoredSince END
         WHERE ip = ?`,
        [JSON.stringify(students), time, isMonitored, isMonitored, time, ip]
      );
    }
  } catch (error) {
    console.error('Error updating IP record:', error);
  }
}

// 9. 解除IP监测
app.post('/api/ip/unblock', async (req, res) => {
  try {
    const { ip } = req.body;
    await db.run('DELETE FROM ip_records WHERE ip = ?', [ip]);
    res.json({ success: true });
  } catch (error) {
    console.error('Error unblocking IP:', error);
    res.status(500).json({ error: error.message });
  }
});

// 10. 获取所有IP记录
app.get('/api/ip/records', async (req, res) => {
  try {
    const records = await db.all('SELECT * FROM ip_records');
    res.json(records);
  } catch (error) {
    console.error('Error fetching IP records:', error);
    res.status(500).json({ error: error.message });
  }
});

// 11. 卖家验证
app.post('/api/seller/verify', async (req, res) => {
  try {
    const { birthday } = req.body;
    const seller = await db.get('SELECT birthday FROM seller WHERE id = 1');
    res.json({ success: seller.birthday === birthday });
  } catch (error) {
    console.error('Error verifying seller:', error);
    res.status(500).json({ error: error.message });
  }
});

// 12. 初始化物品数据（如果需要）
app.post('/api/items/init', async (req, res) => {
  try {
    const { items } = req.body;
    for (const item of items) {
      await db.run(
        `INSERT OR REPLACE INTO items (id, name, description, condition, priceType, price, image, claimed) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [item.id, item.name, item.description, item.condition, item.priceType, item.price, item.image, item.claimed ? 1 : 0]
      );
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Error initializing items:', error);
    res.status(500).json({ error: error.message });
  }
});

// 所有其他请求返回 index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
