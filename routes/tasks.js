// ==========================
// 定时任务接口
// /task_management.php?action=list|add|delete|toggle
// 前端以 application/x-www-form-urlencoded 提交
// ==========================
const express = require('express');
const { dbWithRetry } = require('../db');

const router = express.Router();

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/; // HH:MM
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;        // YYYY-MM-DD

// 校验 weekdays：逗号分隔的 0-6（JS getDay：0=周日..6=周六）
function normalizeWeekdays(raw) {
    const parts = String(raw || '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s !== '');
    const valid = parts.filter((s) => /^[0-6]$/.test(s));
    // 去重并排序
    const uniq = [...new Set(valid)].sort();
    return uniq.join(',');
}

// 任务列表
async function handleList(req, res) {
    const deviceId = (req.query.device_id || '').trim();
    const master = (req.query.master || '').trim();

    const conditions = [];
    const params = {};
    if (deviceId) {
        conditions.push('device_id = :deviceId');
        params.deviceId = deviceId;
    }
    if (master) {
        conditions.push('master = :master');
        params.master = master;
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [rows] = await dbWithRetry(
        `SELECT id, device_id, master, name, message, type, fire_time, fire_date,
                weekdays, enabled, status, last_fired_at, created_at
         FROM scheduled_tasks
         ${where}
         ORDER BY created_at DESC`,
        params
    );
    return res.json({ success: true, tasks: rows });
}

// 新建任务
async function handleAdd(req, res) {
    if (req.method !== 'POST') return res.json({ success: false, msg: '未知操作' });

    const deviceId = (req.body.device_id || '').trim();
    const master = (req.body.master || '').trim();
    const name = (req.body.name || '').trim();
    const message = (req.body.message || '').trim();
    const type = (req.body.type || '').trim();
    const fireTime = (req.body.fire_time || '').trim();
    let fireDate = (req.body.fire_date || '').trim();
    let weekdays = (req.body.weekdays || '').trim();

    if (!deviceId) return res.json({ success: false, msg: '缺少目标设备' });
    if (!name) return res.json({ success: false, msg: '请输入任务名称' });
    if (!message) return res.json({ success: false, msg: '请输入通知内容' });
    if (!['once', 'daily', 'weekly'].includes(type)) {
        return res.json({ success: false, msg: '任务类型无效' });
    }
    if (!TIME_RE.test(fireTime)) {
        return res.json({ success: false, msg: '时间格式应为 HH:MM' });
    }

    if (type === 'once') {
        if (!DATE_RE.test(fireDate)) {
            return res.json({ success: false, msg: '一次性任务需选择日期' });
        }
        weekdays = null;
    } else if (type === 'weekly') {
        weekdays = normalizeWeekdays(weekdays);
        if (!weekdays) {
            return res.json({ success: false, msg: '每周任务需至少选择一天' });
        }
        fireDate = null;
    } else {
        // daily
        fireDate = null;
        weekdays = null;
    }

    await dbWithRetry(
        `INSERT INTO scheduled_tasks
            (device_id, master, name, message, type, fire_time, fire_date, weekdays, enabled, status)
         VALUES
            (:deviceId, :master, :name, :message, :type, :fireTime, :fireDate, :weekdays, 1, 'pending')`,
        { deviceId, master, name, message, type, fireTime, fireDate, weekdays }
    );

    return res.json({ success: true, msg: '任务创建成功' });
}

// 删除任务
async function handleDelete(req, res) {
    if (req.method !== 'POST') return res.json({ success: false, msg: '未知操作' });

    const id = parseInt(req.body.id, 10) || 0;
    if (id <= 0) return res.json({ success: false, msg: '无效的任务ID' });

    const [result] = await dbWithRetry('DELETE FROM scheduled_tasks WHERE id = :id', { id });
    if (result.affectedRows > 0) {
        return res.json({ success: true, msg: '任务删除成功' });
    }
    return res.json({ success: false, msg: '任务不存在' });
}

// 启用/停用任务
async function handleToggle(req, res) {
    if (req.method !== 'POST') return res.json({ success: false, msg: '未知操作' });

    const id = parseInt(req.body.id, 10) || 0;
    if (id <= 0) return res.json({ success: false, msg: '无效的任务ID' });
    const enabled = req.body.enabled == 1 || req.body.enabled === 'true' ? 1 : 0;

    const [result] = await dbWithRetry(
        'UPDATE scheduled_tasks SET enabled = :enabled WHERE id = :id',
        { enabled, id }
    );
    if (result.affectedRows > 0) {
        return res.json({ success: true, msg: enabled ? '任务已启用' : '任务已停用' });
    }
    return res.json({ success: false, msg: '任务不存在' });
}

router.all('/task_management.php', async (req, res) => {
    const action = req.query.action || '';
    try {
        switch (action) {
            case 'list':
                return await handleList(req, res);
            case 'add':
                return await handleAdd(req, res);
            case 'delete':
                return await handleDelete(req, res);
            case 'toggle':
                return await handleToggle(req, res);
            default:
                return res.json({ success: false, msg: '未知操作' });
        }
    } catch (err) {
        console.error('[接口错误] /task_management.php:', err.message);
        return res.json({ success: false, msg: '系统错误，请稍后再试' });
    }
});

module.exports = router;
