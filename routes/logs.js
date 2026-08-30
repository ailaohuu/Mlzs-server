// ==========================
// 日志接口
// POST /log                                  写入日志 {account, logData}
// GET  /api/log?user=&lines=                  读取日志（纯文本）—— 原 Node 接口
// GET  /log_list.php?master=                  读取日志（JSON {logs:[...]}）—— 整合自 log_list.php
// GET  /log_proxy.php?action=get_log&...      读取日志（纯文本）—— 整合自 log_proxy.php
// POST /log_proxy.php (action=send_message)   转发消息 —— 整合自 log_proxy.php
// ==========================
const express = require('express');
const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const clientStore = require('../clientStore');

const router = express.Router();

// 日志根目录（指向 Mlzs-node/logs）
const LOG_ROOT = path.join(__dirname, '..', 'logs');

const ensureLogDir = (user) => {
    const userDir = path.join(LOG_ROOT, user);
    if (!fsSync.existsSync(userDir)) {
        fsSync.mkdirSync(userDir, { recursive: true });
    }
    return userDir;
};

// 读取指定用户日志文件的最后 N 行（返回字符串数组），文件不存在返回 null
async function readLastLines(user, lines) {
    const logFile = path.join(LOG_ROOT, user, `${user}.log`);
    try {
        await fs.access(logFile);
    } catch {
        return null;
    }
    const content = await fs.readFile(logFile, 'utf8');
    const logLines = content.split(/\r\n|\n/).filter((line) => line.trim() !== '');
    return logLines.slice(-lines);
}

// 写入日志
router.post('/log', async (req, res) => {
    try {
        const { account, logData } = req.body;
        if (!account || !logData) {
            return res.status(400).json({ error: '缺少 account 或 logData 参数' });
        }

        const logDir = ensureLogDir(account);
        const logFile = path.join(logDir, `${account}.log`);
        const logContent = `[${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}] ${logData}\n`;

        await fs.appendFile(logFile, logContent, 'utf8');
        res.json({ success: true });
    } catch (error) {
        console.error('[接口错误] /log:', error.message);
        res.status(500).json({ error: '日志存储失败' });
    }
});

// 读取日志（纯文本）
router.get('/api/log', async (req, res) => {
    try {
        const { user } = req.query;
        const lines = parseInt(req.query.lines, 10) || 10;
        if (!user) return res.status(400).json({ error: '缺少 user 参数' });

        const lastLines = await readLastLines(user, lines);
        if (lastLines === null) {
            return res.status(404).json({ error: '日志文件不存在' });
        }

        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.send(lastLines.join('\n'));
    } catch (error) {
        console.error('[接口错误] /api/log:', error.message);
        res.status(500).json({ error: '日志读取失败' });
    }
});

// 日志列表（JSON）—— 供前端 index.html / admin.html 使用
router.get('/log_list.php', async (req, res) => {
    try {
        const master = (req.query.master || '').trim();
        if (!master) {
            return res.json({ error: '请指定设备使用人' });
        }

        const lastLines = await readLastLines(master, 100);
        if (lastLines === null) {
            return res.json({ logs: [], message: '日志不存在' });
        }
        res.json({ logs: lastLines });
    } catch (error) {
        console.error('[接口错误] /log_list.php:', error.message);
        res.json({ error: '获取日志失败' });
    }
});

// 日志代理（兼容 log_proxy.php）
router.all('/log_proxy.php', async (req, res) => {
    try {
        // 读取日志（纯文本，截最后 50 行）
        if (req.query.action === 'get_log') {
            const user = req.query.user || '';
            if (!user) {
                return res.json({ error: '缺少用户名' });
            }
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            const lastLines = await readLastLines(user, 50);
            if (lastLines === null) {
                return res.send('(日志不存在)');
            }
            return res.send(lastLines.join('\n'));
        }

        // 转发消息
        if (req.body && req.body.action === 'send_message') {
            const { deviceId, message } = req.body;
            if (!deviceId || !message) {
                return res.json({ error: '缺少 deviceId 或 message' });
            }
            const result = clientStore.sendMessage(deviceId, message);
            return res.status(result.status).json(result.body);
        }

        return res.json({ error: '无效的接口请求' });
    } catch (error) {
        console.error('[接口错误] /log_proxy.php:', error.message);
        res.json({ error: '服务器内部错误' });
    }
});

module.exports = { router, ensureLogDir, LOG_ROOT };
