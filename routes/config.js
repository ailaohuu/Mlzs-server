// ==========================
// 客户端配置接口
// GET /client_config.php?action=get&master=xxx[&device_id=yyy] -> { success, config }
//
// 配置由客户端通过 socket.io 的 config 事件上报（见 index.js），本接口只读。
// 表以 master 为主键，即一个使用人一份配置；同一使用人换设备时覆盖同一行。
// ==========================
const express = require('express');
const { dbWithRetry } = require('../db');

const router = express.Router();

const SELECT_COLUMNS = 'master, device_Id, server_Uid, server_key, corp_Id, updated_at';

// 取单条配置：优先按 master（主键）查，未提供 master 时按 device_Id 查最新一条
async function handleGet(req, res) {
    const master = (req.query.master || '').trim();
    const deviceId = (req.query.device_id || '').trim();

    if (!master && !deviceId) {
        return res.json({ success: false, msg: '缺少 master 或 device_id 参数' });
    }

    let rows;
    if (master) {
        [rows] = await dbWithRetry(
            `SELECT ${SELECT_COLUMNS} FROM client_config WHERE master = :master`,
            { master }
        );
    } else {
        [rows] = await dbWithRetry(
            `SELECT ${SELECT_COLUMNS} FROM client_config
             WHERE device_Id = :deviceId
             ORDER BY updated_at DESC
             LIMIT 1`,
            { deviceId }
        );
    }

    return res.json({ success: true, config: rows[0] || null });
}

router.all('/client_config.php', async (req, res) => {
    const action = req.query.action || 'get';
    try {
        switch (action) {
            case 'get':
                return await handleGet(req, res);
            default:
                return res.json({ success: false, msg: '未知操作' });
        }
    } catch (err) {
        console.error('[接口错误] /client_config.php:', err.message);
        return res.json({ success: false, msg: '数据库连接失败' });
    }
});

module.exports = router;
