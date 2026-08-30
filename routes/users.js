// ==========================
// 用户管理接口（移植自 user_management.php）
// /user_management.php?action=list|delete|edit|add|count
// 前端以 application/x-www-form-urlencoded 提交
// ==========================
const express = require('express');
const bcrypt = require('bcryptjs');
const { dbWithRetry } = require('../db');

const router = express.Router();

// 用户列表
async function handleList(req, res) {
    const search = (req.query.search || '').trim();

    let rows;
    if (search) {
        const pattern = `%${search}%`;
        [rows] = await dbWithRetry(
            `SELECT id, username, realname as email, role,
                    CASE WHEN id > 0 THEN 'active' ELSE 'inactive' END as status,
                    created_at
             FROM users
             WHERE username LIKE :pattern OR realname LIKE :pattern
             ORDER BY created_at DESC`,
            { pattern }
        );
    } else {
        [rows] = await dbWithRetry(
            `SELECT id, username, realname as email, role,
                    CASE WHEN id > 0 THEN 'active' ELSE 'inactive' END as status,
                    created_at
             FROM users
             ORDER BY created_at DESC`
        );
    }

    return res.json({ success: true, users: rows });
}

// 删除用户
async function handleDelete(req, res) {
    if (req.method !== 'POST') return res.json({ success: false, msg: '未知操作' });

    const userId = parseInt(req.body.user_id, 10) || 0;
    if (userId <= 0) {
        return res.json({ success: false, msg: '无效的用户ID' });
    }

    // 不允许删除管理员账户
    const [rows] = await dbWithRetry('SELECT role FROM users WHERE id = :id', { id: userId });
    if (rows.length > 0 && rows[0].role === 'admin') {
        return res.json({ success: false, msg: '不能删除管理员账户' });
    }

    const [result] = await dbWithRetry("DELETE FROM users WHERE id = :id AND role != 'admin'", { id: userId });
    if (result.affectedRows > 0) {
        return res.json({ success: true, msg: '用户删除成功' });
    }
    return res.json({ success: false, msg: '用户不存在或无权限删除' });
}

// 编辑用户
async function handleEdit(req, res) {
    if (req.method !== 'POST') return res.json({ success: false, msg: '未知操作' });

    const userId = parseInt(req.body.user_id, 10) || 0;
    const realname = (req.body.realname || '').trim();
    let role = (req.body.role || 'user').trim();

    if (userId <= 0) return res.json({ success: false, msg: '无效的用户ID' });
    if (!realname) return res.json({ success: false, msg: '真实姓名不能为空' });
    if (!['user', 'admin'].includes(role)) role = 'user';

    const [result] = await dbWithRetry(
        "UPDATE users SET realname = :realname, role = :role WHERE id = :id AND role != 'admin'",
        { realname, role, id: userId }
    );
    if (result.affectedRows > 0) {
        return res.json({ success: true, msg: '用户更新成功' });
    }
    return res.json({ success: false, msg: '用户不存在或无权限修改' });
}

// 添加用户
async function handleAdd(req, res) {
    if (req.method !== 'POST') return res.json({ success: false, msg: '未知操作' });

    const username = (req.body.username || '').trim();
    const password = (req.body.password || '').trim();
    const realname = (req.body.realname || '').trim();
    let role = (req.body.role || 'user').trim();

    if (!username) return res.json({ success: false, msg: '用户名不能为空' });
    if (!password) return res.json({ success: false, msg: '密码不能为空' });
    if (password.length < 6) return res.json({ success: false, msg: '密码长度至少6位' });
    if (!realname) return res.json({ success: false, msg: '真实姓名不能为空' });
    if (!['user', 'admin'].includes(role)) role = 'user';

    // 检查用户名是否已存在
    const [exists] = await dbWithRetry('SELECT id FROM users WHERE username = :username', { username });
    if (exists.length > 0) {
        return res.json({ success: false, msg: '用户名已存在' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await dbWithRetry(
        'INSERT INTO users (username, password, realname, role) VALUES (:username, :password, :realname, :role)',
        { username, password: hashedPassword, realname, role }
    );
    return res.json({ success: true, msg: '用户添加成功' });
}

// 用户总数
async function handleCount(req, res) {
    const [rows] = await dbWithRetry('SELECT COUNT(*) as count FROM users');
    return res.json({ success: true, count: rows[0].count });
}

router.all('/user_management.php', async (req, res) => {
    const action = req.query.action || '';
    try {
        switch (action) {
            case 'list':
                return await handleList(req, res);
            case 'delete':
                return await handleDelete(req, res);
            case 'edit':
                return await handleEdit(req, res);
            case 'add':
                return await handleAdd(req, res);
            case 'count':
                return await handleCount(req, res);
            default:
                return res.json({ success: false, msg: '未知操作' });
        }
    } catch (err) {
        console.error('[接口错误] /user_management.php:', err.message);
        return res.json({ success: false, msg: '数据库连接失败' });
    }
});

module.exports = router;
