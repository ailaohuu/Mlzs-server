// ==========================
// 客户端 HTTP token 认证接口
// POST /client-auth?action=login  -> 使用用户名/密码签发长效 token
// POST /client-auth?action=getconfig -> 仅使用 token 获取当前用户的设备配置
// ==========================
const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { dbPool, dbWithRetry } = require('../db');
const config = require('../config');

const router = express.Router();
const TOKEN_DAYS = 365;
const TOKEN_BYTES = 32;
const USER_COLUMNS = 'id, username, realname, role';
const TOKEN_KEY = crypto.createHash('sha256').update(config.tokenSecret, 'utf8').digest();

function hashToken(token) {
    return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

function encryptToken(token) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', TOKEN_KEY, iv);
    const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('base64')}.${tag.toString('base64')}.${encrypted.toString('base64')}`;
}

function decryptToken(value) {
    if (!value) return '';
    const parts = String(value).split('.');
    if (parts.length !== 3) return '';

    const decipher = crypto.createDecipheriv('aes-256-gcm', TOKEN_KEY, Buffer.from(parts[0], 'base64'));
    decipher.setAuthTag(Buffer.from(parts[1], 'base64'));
    return Buffer.concat([
        decipher.update(Buffer.from(parts[2], 'base64')),
        decipher.final(),
    ]).toString('utf8');
}

function readBearerToken(req) {
    const authorization = req.get('authorization') || '';
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    return match ? match[1].trim() : '';
}

function getToken(req) {
    const token = typeof req.body.token === 'string' ? req.body.token.trim() : '';
    return token || readBearerToken(req);
}

async function handleLogin(req, res) {
    const username = String(req.body.username ?? req.body.user ?? '').trim();
    const password = String(req.body.password ?? req.body.pwd ?? '').trim();

    if (!username || !password) {
        return res.json({ success: false, msg: '用户名和密码不能为空' });
    }

    const [rows] = await dbWithRetry(
        `SELECT ${USER_COLUMNS}, password FROM users WHERE username = :username`,
        { username }
    );
    if (rows.length === 0 || !(await bcrypt.compare(password, rows[0].password))) {
        return res.json({ success: false, msg: '用户名或密码错误' });
    }

    const user = rows[0];
    delete user.password;

    const connection = await dbPool.getConnection();
    try {
        await connection.beginTransaction();

        // 锁定该用户现有 token，避免并发重复登录时签发多个有效 token
        const [existingRows] = await connection.query(`
            SELECT id, token_encrypted, expires_at
            FROM client_auth_tokens
            WHERE user_id = :userId
              AND revoked_at IS NULL
              AND expires_at > NOW()
            ORDER BY created_at DESC
            LIMIT 1
            FOR UPDATE
        `, { userId: user.id });

        if (existingRows.length > 0 && existingRows[0].token_encrypted) {
            try {
                const existingToken = decryptToken(existingRows[0].token_encrypted);
                if (existingToken) {
                    await connection.query(
                        'UPDATE client_auth_tokens SET last_used_at = NOW() WHERE id = :id',
                        { id: existingRows[0].id }
                    );
                    await connection.commit();

                    console.log(`[客户端登录] 用户 ${username} 登录成功，返回现有有效 token`);
                    return res.json({
                        success: true,
                        token: existingToken,
                        expires_at: new Date(existingRows[0].expires_at).toISOString(),
                        reused: true,
                        user,
                    });
                }
            } catch (err) {
                console.warn(`[客户端登录] 用户 ${username} 的现有 token 无法解密，将重新签发:`, err.message);
            }
        }

        // 旧版本记录只保存了哈希，无法还原明文；将其撤销后签发一个可重复返回的新 token
        await connection.query(`
            UPDATE client_auth_tokens
            SET revoked_at = NOW()
            WHERE user_id = :userId
              AND revoked_at IS NULL
        `, { userId: user.id });

        const token = crypto.randomBytes(TOKEN_BYTES).toString('hex');
        const expiresAt = new Date(Date.now() + TOKEN_DAYS * 24 * 60 * 60 * 1000);

        await connection.query(`
            INSERT INTO client_auth_tokens (user_id, token_hash, token_encrypted, expires_at)
            VALUES (:userId, :tokenHash, :tokenEncrypted, :expiresAt)
        `, {
            userId: user.id,
            tokenHash: hashToken(token),
            tokenEncrypted: encryptToken(token),
            expiresAt,
        });
        await connection.commit();

        console.log(`[客户端登录] 用户 ${username} 登录成功，已签发 ${TOKEN_DAYS} 天 token`);
        return res.json({
            success: true,
            token,
            expires_at: expiresAt.toISOString(),
            reused: false,
            user,
        });
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
}

async function handleGetConfig(req, res) {
    const token = getToken(req);

    if (!token || token.length > 256) {
        return res.json({ success: false, msg: 'token 无效' });
    }

    // token 唯一确定用户身份，返回该用户全部设备的配置
    const [rows] = await dbWithRetry(`
        SELECT cc.master, cc.device_Id, cc.server_Uid, cc.server_key, cc.corp_Id, cc.updated_at
        FROM client_auth_tokens t
        INNER JOIN users u ON u.id = t.user_id
        INNER JOIN client_config cc ON (cc.master = u.realname OR cc.master = u.username)
        WHERE t.token_hash = :tokenHash
          AND t.revoked_at IS NULL
          AND t.expires_at > NOW()
        ORDER BY cc.updated_at DESC
        LIMIT 1
    `, { tokenHash: hashToken(token) });

    if (rows.length === 0) {
        const [tokenRows] = await dbWithRetry(`
            SELECT id
            FROM client_auth_tokens
            WHERE token_hash = :tokenHash
              AND revoked_at IS NULL
              AND expires_at > NOW()
            LIMIT 1
        `, { tokenHash: hashToken(token) });
        if (tokenRows.length === 0) {
            return res.json({ success: false, msg: 'token 无效或已过期' });
        }

        return res.json({ success: true, config: null, msg: '未找到对应设备配置' });
    }

    await dbWithRetry(
        'UPDATE client_auth_tokens SET last_used_at = NOW() WHERE token_hash = :tokenHash',
        { tokenHash: hashToken(token) }
    );

    return res.json({ success: true, config: rows[0] });
}

async function handleVerify(req, res) {
    const token = getToken(req);
    if (!token || token.length > 256) {
        return res.json({ success: false, msg: 'token 无效' });
    }

    const [rows] = await dbWithRetry(`
        SELECT t.expires_at, u.id, u.username, u.realname, u.role
        FROM client_auth_tokens t
        INNER JOIN users u ON u.id = t.user_id
        WHERE t.token_hash = :tokenHash
          AND t.revoked_at IS NULL
          AND t.expires_at > NOW()
        LIMIT 1
    `, { tokenHash: hashToken(token) });

    if (rows.length === 0) {
        return res.json({ success: false, msg: 'token 无效或已过期' });
    }

    const row = rows[0];
    await dbWithRetry(
        'UPDATE client_auth_tokens SET last_used_at = NOW() WHERE token_hash = :tokenHash',
        { tokenHash: hashToken(token) }
    );

    return res.json({
        success: true,
        user: {
            id: row.id,
            username: row.username,
            realname: row.realname,
            role: row.role,
        },
        expires_at: new Date(row.expires_at).toISOString(),
    });
}

router.all('/client-auth', async (req, res) => {
    if (req.method !== 'POST') {
        return res.json({ success: false, msg: '只支持 POST 请求' });
    }

    try {
        switch (req.query.action || '') {
            case 'login':
                return await handleLogin(req, res);
            case 'verify':
                return await handleVerify(req, res);
            case 'getconfig':
                return await handleGetConfig(req, res);
            default:
                return res.json({ success: false, msg: '未知操作' });
        }
    } catch (err) {
        console.error('[接口错误] /client-auth:', err.message);
        return res.json({ success: false, msg: '系统错误，请稍后再试' });
    }
});

module.exports = router;
