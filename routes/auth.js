// ==========================
// 路径：/auth?action=register|login|check|changePassword
// 前端以 application/x-www-form-urlencoded 提交，字段：user/pwd/name/currentPwd/newPwd
// ==========================
const express = require('express');
const bcrypt = require('bcryptjs');
const { dbWithRetry } = require('../db');

const router = express.Router();

// 确保 users 表存在（兼容未初始化的库）
async function ensureUsersTable() {
    await dbWithRetry(`
        CREATE TABLE IF NOT EXISTS users (
            id INT AUTO_INCREMENT PRIMARY KEY,
            username VARCHAR(50) NOT NULL UNIQUE,
            password VARCHAR(255) NOT NULL,
            realname VARCHAR(100) NOT NULL,
            role ENUM('admin', 'user') NOT NULL DEFAULT 'user',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
    `);
}

// 注册
async function handleRegister(req, res) {
    const username = (req.body.user || '').trim();
    const password = (req.body.pwd || '').trim();
    const realname = (req.body.name || '').trim();

    if (!username) return res.json({ success: false, msg: '请输入用户名' });
    if (!password) return res.json({ success: false, msg: '请输入密码' });
    if (password.length < 6) return res.json({ success: false, msg: '密码长度至少6位' });
    if (!realname) return res.json({ success: false, msg: '请输入真实姓名' });

    // 检查用户名是否已存在
    const [exists] = await dbWithRetry('SELECT id FROM users WHERE username = :username', { username });
    if (exists.length > 0) {
        return res.json({ success: false, msg: '用户名已存在' });
    }

    await ensureUsersTable();

    const hashedPassword = await bcrypt.hash(password, 10);
    // 注册用户只能是普通用户角色
    await dbWithRetry(
        'INSERT INTO users (username, password, realname, role) VALUES (:username, :password, :realname, :role)',
        { username, password: hashedPassword, realname, role: 'user' }
    );

    console.log(`注册成功: username=${username}`);
    return res.json({ success: true, msg: '注册成功' });
}

// 登录
async function handleLogin(req, res) {
    const username = (req.body.user || '').trim();
    const password = (req.body.pwd || '').trim();

    if (!username) return res.json({ success: false, msg: '请输入用户名' });
    if (!password) return res.json({ success: false, msg: '请输入密码' });

    const [rows] = await dbWithRetry(
        'SELECT id, username, realname, password, role FROM users WHERE username = :username',
        { username }
    );

    if (rows.length === 0) {
        return res.json({ success: false, msg: '用户不存在，请先注册' });
    }

    const user = rows[0];
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
        return res.json({ success: false, msg: '用户名或密码错误' });
    }

    // 移除密码字段
    delete user.password;
    return res.json({ success: true, user });
}

// 检查登录状态
async function handleCheck(req, res) {
    const userData = (req.body.user || '').trim();
    if (!userData) return res.json({ success: false, msg: '用户信息为空' });

    let parsed;
    try {
        parsed = JSON.parse(userData);
    } catch {
        return res.json({ success: false, msg: '用户信息格式错误' });
    }
    if (!parsed || !parsed.username) {
        return res.json({ success: false, msg: '用户信息格式错误' });
    }

    const [rows] = await dbWithRetry(
        'SELECT id, username, realname, role FROM users WHERE username = :username',
        { username: parsed.username }
    );
    if (rows.length === 0) {
        return res.json({ success: false, msg: '用户不存在，请先注册' });
    }
    return res.json({ success: true });
}

// 修改密码
async function handleChangePassword(req, res) {
    if (req.method !== 'POST') {
        return res.json({ success: false, msg: '无效的请求方法' });
    }

    const username = (req.body.user || '').trim();
    const currentPassword = (req.body.currentPwd || '').trim();
    const newPassword = (req.body.newPwd || '').trim();

    if (req.body.user === undefined || req.body.currentPwd === undefined || req.body.newPwd === undefined) {
        return res.json({ success: false, msg: '请求参数不完整' });
    }
    if (!username) return res.json({ success: false, msg: '用户名不能为空' });
    if (!currentPassword) return res.json({ success: false, msg: '请输入当前密码' });
    if (!newPassword) return res.json({ success: false, msg: '请输入新密码' });
    if (newPassword.length < 6) return res.json({ success: false, msg: '新密码长度至少6位' });

    const [rows] = await dbWithRetry('SELECT id, password FROM users WHERE username = :username', { username });
    if (rows.length === 0) {
        return res.json({ success: false, msg: '用户不存在' });
    }

    const user = rows[0];
    const ok = await bcrypt.compare(currentPassword, user.password);
    if (!ok) {
        return res.json({ success: false, msg: '当前密码错误' });
    }

    const hashedNewPassword = await bcrypt.hash(newPassword, 10);
    await dbWithRetry('UPDATE users SET password = :password WHERE id = :id', {
        password: hashedNewPassword,
        id: user.id,
    });

    await dbWithRetry('UPDATE client_auth_tokens SET revoked_at = NOW() WHERE user_id = :userId AND revoked_at IS NULL', {
        userId: user.id,
    });

    console.log(`密码修改成功: username=${username}`);
    return res.json({ success: true, msg: '密码修改成功，请重新登录' });
}

router.all('/auth', async (req, res) => {
    const action = req.query.action;
    try {
        switch (action) {
            case 'register':
                return await handleRegister(req, res);
            case 'login':
                return await handleLogin(req, res);
            case 'check':
                return await handleCheck(req, res);
            case 'changePassword':
                return await handleChangePassword(req, res);
            default:
                return res.json({ success: false, msg: '无效请求' });
        }
    } catch (err) {
        console.error('[接口错误] /auth:', err.message);
        return res.json({ success: false, msg: '系统错误，请稍后再试' });
    }
});

module.exports = { router, ensureUsersTable };
