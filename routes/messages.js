// ==========================
// 消息发送接口
// POST /send-message      (JSON: {deviceId, message})  —— 原 Node 接口
// POST /send_message.php  (JSON: {deviceId, message})  —— 整合自 send_message.php（原为 PHP 转发层）
// ==========================
const express = require('express');
const clientStore = require('../clientStore');

const router = express.Router();

function handleSend(req, res) {
    try {
        const { deviceId, message } = req.body || {};

        console.log('--- 发送消息接口被调用 ---');
        console.log('收到的 deviceId:', deviceId);

        const result = clientStore.sendMessage(deviceId, message);
        return res.status(result.status).json(result.body);
    } catch (error) {
        console.error('[接口错误] send-message:', error.message);
        return res.status(500).json({ error: '服务器内部错误' });
    }
}

router.post('/send-message', handleSend);
router.post('/send_message.php', handleSend);

module.exports = router;
