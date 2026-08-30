// ==========================
// 设备接口（移植自 device_list.php、remove_device.php）
// GET  /device_list.php?master=xxx   -> { devices: [...] }
// POST /remove_device.php (device_id, master) -> { success, msg, affected_rows }
// ==========================
const express = require('express');
const { dbWithRetry } = require('../db');

const router = express.Router();

// 设备列表
// 普通用户（提供 master）：只看自己的在线设备
// 管理员（不提供 master）：看所有设备（含在线和离线）
router.get('/device_list.php', async (req, res) => {
    try {
        const master = (req.query.master || '').trim();

        let rows;
        if (master) {
            [rows] = await dbWithRetry(
                `SELECT device_id, master, status, updated_at, client_version, battery_level, charging, listening
                 FROM clients
                 WHERE status = 'online' AND master = :master
                 ORDER BY updated_at DESC`,
                { master }
            );
        } else {
            [rows] = await dbWithRetry(
                `SELECT device_id, master, status, updated_at, client_version, battery_level, charging, listening
                 FROM clients
                 ORDER BY updated_at DESC`
            );
        }

        res.json({ devices: rows });
    } catch (err) {
        console.error('[接口错误] /device_list.php:', err.message);
        res.json({ error: '数据库连接失败' });
    }
});

// 删除设备
router.post('/remove_device.php', async (req, res) => {
    try {
        const deviceId = (req.body.device_id || '').trim();
        const master = (req.body.master || '').trim();

        if (!deviceId) {
            return res.json({ success: false, msg: '设备ID不能为空' });
        }

        // 检查设备是否存在且属于该用户
        const [exists] = await dbWithRetry(
            'SELECT device_id FROM clients WHERE device_id = :deviceId AND master = :master',
            { deviceId, master }
        );
        if (exists.length === 0) {
            return res.json({ success: false, msg: '设备不存在或不属于该用户' });
        }

        const [result] = await dbWithRetry(
            'DELETE FROM clients WHERE device_id = :deviceId AND master = :master',
            { deviceId, master }
        );

        if (result.affectedRows > 0) {
            return res.json({ success: true, msg: '设备删除成功', affected_rows: result.affectedRows });
        }
        return res.json({ success: false, msg: '设备删除失败：未影响任何记录' });
    } catch (err) {
        console.error('[接口错误] /remove_device.php:', err.message);
        res.json({ success: false, msg: '设备删除失败: ' + err.message });
    }
});

module.exports = router;
