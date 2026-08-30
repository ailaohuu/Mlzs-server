// ==========================
// 共享客户端状态：在线设备的内存 Map + Socket.io 实例
// 由 index.js 在启动时通过 init() 注入，供路由模块复用消息发送逻辑。
// ==========================
const store = {
    io: null,
    clients: null, // Map<deviceId, socket>
};

function init(io, clients) {
    store.io = io;
    store.clients = clients;
}

function getClients() {
    return store.clients;
}

/**
 * 向指定设备发送消息（供 /send-message、/send_message.php、/log_proxy.php 复用）
 * @returns {{status:number, body:object}}
 */
function sendMessage(deviceId, message) {
    if (!deviceId || message === undefined) {
        return { status: 400, body: { error: '缺少 deviceId 或 message 参数' } };
    }
    if (!store.clients || !store.clients.has(deviceId)) {
        console.warn(`警告：尝试向不存在的 deviceId ${deviceId} 发送消息`);
        return { status: 404, body: { error: '客户端未连接或已断开' } };
    }

    store.io.to(deviceId).emit('message', message);
    console.log(`[接口] 已向设备 ${deviceId} 发送消息`);
    return { status: 200, body: { success: true, deviceId, timestamp: Date.now() } };
}

/**
 * 向指定设备下发定时通知（供调度器 scheduler.js 复用）
 * @returns {{status:number, body:object}}
 */
function sendNotification(deviceId, payload) {
    if (!deviceId) {
        return { status: 400, body: { error: '缺少 deviceId' } };
    }
    if (!store.clients || !store.clients.has(deviceId)) {
        return { status: 404, body: { error: '客户端未连接或已断开' } };
    }

    store.io.to(deviceId).emit('notification', payload);
    console.log(`[通知] 已向设备 ${deviceId} 下发定时通知:`, payload && payload.name);
    return { status: 200, body: { success: true, deviceId, timestamp: Date.now() } };
}

module.exports = { init, getClients, sendMessage, sendNotification };
