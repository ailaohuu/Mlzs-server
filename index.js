const express = require('express');
const http = require('http');
const path = require('path');
const fsSync = require('fs');
const { Server } = require('socket.io');
const cors = require('cors');

const config = require('./config');
const { dbPool, dbWithRetry, testDbConnection, ensureClientColumns, ensureScheduledTasksTable, ensureClientConfigTable, ensureClientAuthTokensTable } = require('./db');
const clientStore = require('./clientStore');
const { startScheduler } = require('./scheduler');

// 路由模块
const { router: authRouter, ensureUsersTable } = require('./routes/auth');
const devicesRouter = require('./routes/devices');
const usersRouter = require('./routes/users');
const { router: logsRouter, LOG_ROOT } = require('./routes/logs');
const messagesRouter = require('./routes/messages');
const tasksRouter = require('./routes/tasks');
const configRouter = require('./routes/config');
const clientAuthRouter = require('./routes/client-auth');

// ==========================
// Express 应用配置
// ==========================
const app = express();
const server = http.createServer(app);

// CORS：来源由 .env 的 CORS_ORIGINS 控制；为空则允许同源/任意来源
const corsOrigin = config.corsOrigins.length > 0 ? config.corsOrigins : true;

app.use(cors({
    origin: corsOrigin,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
    credentials: true,
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// 静态前端（index.html / login.html / admin.html / css / fonts ...）
app.use(express.static(path.join(__dirname, 'public')));

// ==========================
// Socket.io 核心配置
// ==========================
const io = new Server(server, {
    cors: { origin: corsOrigin },
});

// 存储客户端信息，key 为 deviceId，value 为 socket 对象
const clients = new Map();

// 把 io 与 clients 注入共享存储，供 HTTP 路由复用消息发送逻辑
clientStore.init(io, clients);

// ==========================
// HTTP 路由挂载
// ==========================
app.use(authRouter);
app.use(devicesRouter);
app.use(usersRouter);
app.use(logsRouter);
app.use(messagesRouter);
app.use(tasksRouter);
app.use(configRouter);
app.use(clientAuthRouter);

// 健康检查接口
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        online_clients: clients.size,
        database: 'connected',
    });
});

// ==========================
// 工具函数
// ==========================

/**
 * 客户端断开连接时的清理工作
 * @param {string} deviceId - 设备ID
 * @param {string} reason - 断开原因
 * @param {object} originSocket - 触发清理的 socket，用于身份校验，避免旧连接误删新连接
 */
async function cleanupClient(deviceId, reason, originSocket) {
    if (deviceId && clients.has(deviceId)) {
        const socket = clients.get(deviceId);

        // 身份校验：当前内存中的 socket 已被新连接替换时，旧连接的断开事件不得清理新连接
        if (originSocket && socket && socket !== originSocket) {
            console.log(`[清理跳过] 设备 ${deviceId} 的内存连接已被新连接替换，忽略旧连接的清理`);
            return;
        }

        // 检查socket是否正在重连
        if (socket && (socket.isReconnecting || socket.willReconnect)) {
            console.log(`[清理跳过] 设备 ${deviceId} 正在重连，跳过清理`);
            return;
        }

        // 从内存中移除
        clients.delete(deviceId);
        console.log(`[清理] 设备 ${deviceId} 已从内存中移除。原因: ${reason}`);

        // 更新数据库状态
        try {
            await dbWithRetry(`
                UPDATE clients
                SET status = 'offline', updated_at = NOW(), last_offline_at = NOW()
                WHERE device_id = :deviceId
            `, { deviceId });
            console.log(`[数据库] 设备 ${deviceId} 状态已更新为 offline`);
        } catch (err) {
            console.error(`[数据库错误] 更新设备 ${deviceId} 离线状态失败:`, err.message);
        }
    }
}

// ==========================
// Socket.io 连接处理
// ==========================
io.on('connection', (socket) => {
    const clientIp = socket.conn.remoteAddress;
    console.log(`[连接] 新客户端连接。Socket ID: ${socket.id}, IP: ${clientIp}`);

    socket.isAuthenticated = false;
    socket.isReconnecting = false; // 新增：标记是否为重连

    // 检查是否存在相同deviceId的活跃连接
    const checkExistingConnection = async (deviceId) => {
        if (clients.has(deviceId)) {
            const existingSocket = clients.get(deviceId);
            if (existingSocket && existingSocket.connected) {
                console.log(`[重连检测] 设备 ${deviceId} 存在活跃连接，准备处理重连`);
                // 标记旧连接为重连状态，避免被误清理
                existingSocket.isReconnecting = true;
                existingSocket.willReconnect = true;

                // 延迟断开旧连接，给重连留出时间
                setTimeout(() => {
                    if (existingSocket.isReconnecting) {
                        console.log(`[重连清理] 设备 ${deviceId} 重连完成，清理旧连接`);
                        existingSocket.disconnect(true);
                    }
                }, 3000);
                return true;
            }
        }
        return false;
    };

    // 优化认证超时定时器
    const authTimeout = setTimeout(() => {
        if (!socket.isAuthenticated) {
            console.log(`[超时] 客户端 ${socket.id} (IP: ${clientIp}) 15秒内未完成认证，主动断开`);
            socket.disconnect(true);
        }
    }, 15000);

    // 监听身份确认事件
    socket.on('Mlzs', async (msg) => {
        if (socket.isAuthenticated) {
            console.warn(`[重复认证] 设备 ${socket.deviceId || socket.id} 已认证，忽略重复请求`);
            return;
        }

        try {
            // 解析并校验消息格式
            if (typeof msg !== 'string') {
                throw new Error('消息格式错误，应为JSON字符串');
            }
            const dataArray = JSON.parse(msg);
            if (!Array.isArray(dataArray) || dataArray.length < 2) {
                throw new Error('消息内容错误，应为包含至少两个元素的数组 [deviceId, master, ...]');
            }

            const deviceId = dataArray[0];
            const master = dataArray[1];
            const clientVersion = dataArray[2] || 'unknown';

            if (!deviceId || !master) {
                throw new Error('deviceId 和 master 不能为空');
            }

            console.log(`[认证] 收到设备 ${deviceId} (${master}) 的认证请求`);

            // 检查是否正在重连
            const hasExistingConnection = await checkExistingConnection(deviceId);

            // 数据库操作（使用事务）
            const connection = await dbPool.getConnection();
            try {
                await connection.beginTransaction();

                await connection.query(`
                    INSERT INTO clients (
                        device_id, master, status, connected_at, updated_at, last_active_at,
                        ip, client_version
                    ) VALUES (
                        :deviceId, :master, 'online', NOW(), NOW(), NOW(),
                        :ip, :version
                    ) ON DUPLICATE KEY UPDATE
                        master = :master,
                        status = 'online',
                        updated_at = NOW(),
                        last_active_at = NOW(),
                        ip = :ip,
                        client_version = :version,
                        reconnect_count = IFNULL(reconnect_count, 0) + 1,
                        last_offline_at = NULL  -- 清除离线时间标记
                `, {
                    deviceId,
                    master,
                    ip: clientIp,
                    version: clientVersion,
                });

                await connection.commit();
                console.log(`[数据库] 设备 ${deviceId} 认证信息已更新/插入`);

                // 认证成功后的操作
                socket.isAuthenticated = true;
                socket.isReconnecting = false; // 清除重连标记
                socket.deviceId = deviceId;
                socket.master = master;

                // 重要：替换Map中的连接
                clients.set(deviceId, socket);
                socket.join(deviceId); // 加入房间

                clearTimeout(authTimeout); // 清除认证超时定时器

                // 发送认证成功响应
                socket.emit('register_success', {
                    deviceId,
                    master: master,
                    serverTime: Date.now(),
                    message: '认证成功',
                    isReconnect: hasExistingConnection,
                });
                console.log(`[认证成功] 设备 ${deviceId} (${master}) 已上线。当前在线设备数: ${clients.size}`);

            } catch (err) {
                await connection.rollback();
                throw err;
            } finally {
                connection.release();
            }

        } catch (err) {
            console.error(`[认证失败] 设备 ${socket.id} 认证失败:`, err.message);
            socket.emit('register_fail', { reason: '认证失败: ' + err.message });
            // 认证失败后可以选择断开连接
            setTimeout(() => {
                if (!socket.isAuthenticated) {
                    socket.disconnect(true);
                }
            }, 1000);
        }
    });

    // 监听业务消息
    socket.on('message', (data) => {
        const deviceId = socket.deviceId;
        if (!deviceId || !socket.isAuthenticated) {
            console.warn(`[未认证消息] 收到未认证客户端 ${socket.id} 的消息，已忽略`);
            socket.emit('error', { reason: '请先完成认证' });
            return;
        }

        console.log(`[消息] 收到设备 ${deviceId} 的业务消息:`, typeof data === 'object' ? JSON.stringify(data).substring(0, 100) : data);

        // TODO: 处理业务逻辑...
    });

    // 监听电量/充电状态上报事件
    // 负载格式：{ battery: 0-100, charging: true/false }（也兼容 JSON 字符串）
    socket.on('battery', async (payload) => {
        const deviceId = socket.deviceId;
        if (!deviceId || !socket.isAuthenticated) {
            console.warn(`[未认证状态] 收到未认证客户端 ${socket.id} 的状态上报，已忽略`);
            return;
        }

        try {
            let data = payload;
            if (typeof data === 'string') {
                data = JSON.parse(data);
            }
            if (!data || typeof data !== 'object') {
                throw new Error('状态负载格式错误，应为对象 { battery, charging }');
            }

            // 规整电量为 0-100 整数，充电为 0/1
            let battery = null;
            if (data.battery !== undefined && data.battery !== null && data.battery !== '') {
                battery = Math.max(0, Math.min(100, Math.round(Number(data.battery))));
                if (!Number.isFinite(battery)) battery = null;
            }
            const charging = data.charging ? 1 : 0;

            await dbWithRetry(`
                UPDATE clients
                SET battery_level = :battery, charging = :charging, updated_at = NOW(), last_active_at = NOW()
                WHERE device_id = :deviceId
            `, { battery, charging, deviceId });

            console.log(`[状态] 设备 ${deviceId} 电量=${battery ?? '未知'}% 充电=${charging ? '是' : '否'}`);
        } catch (err) {
            console.error(`[状态错误] 设备 ${deviceId} 状态上报处理失败:`, err.message);
        }
    });

    // 监听“监听状态”上报事件（客户端是否正在监听通知）
    // 负载格式：{ listening: true/false }（也兼容 JSON 字符串）
    socket.on('listening', async (payload) => {
        const deviceId = socket.deviceId;
        if (!deviceId || !socket.isAuthenticated) {
            console.warn(`[未认证状态] 收到未认证客户端 ${socket.id} 的监听状态上报，已忽略`);
            return;
        }

        try {
            let data = payload;
            if (typeof data === 'string') {
                data = JSON.parse(data);
            }
            if (!data || typeof data !== 'object') {
                throw new Error('监听状态负载格式错误，应为对象 { listening }');
            }

            const listening = data.listening ? 1 : 0;

            await dbWithRetry(`
                UPDATE clients
                SET listening = :listening, updated_at = NOW(), last_active_at = NOW()
                WHERE device_id = :deviceId
            `, { listening, deviceId });

            console.log(`[状态] 设备 ${deviceId} 监听状态=${listening ? '监听中' : '未监听'}`);
        } catch (err) {
            console.error(`[状态错误] 设备 ${deviceId} 监听状态上报处理失败:`, err.message);
        }
    });

    // 监听客户端配置上报事件
    // 负载格式：{ master, device_Id, server_Uid, server_key, corp_Id }（也兼容 JSON 字符串）
    // master 为 client_config 的主键：同一使用人重复上报（含换设备）覆盖同一行
    socket.on('config', async (payload) => {
        const authDeviceId = socket.deviceId;
        if (!authDeviceId || !socket.isAuthenticated) {
            console.warn(`[未认证配置] 收到未认证客户端 ${socket.id} 的配置上报，已忽略`);
            return;
        }

        try {
            let data = payload;
            if (typeof data === 'string') {
                data = JSON.parse(data);
            }
            if (!data || typeof data !== 'object') {
                throw new Error('配置负载格式错误，应为对象 { master, device_Id, server_Uid, server_key, corp_Id }');
            }

            // 负载缺字段时回落到认证时的身份
            const master = String(data.master ?? socket.master ?? '').trim();
            const deviceId = String(data.device_Id ?? authDeviceId).trim();
            if (!master) throw new Error('master 不能为空');
            if (!deviceId) throw new Error('device_Id 不能为空');

            // 与认证身份不一致时只告警，仍按上报内容入库
            if (deviceId !== authDeviceId) {
                console.warn(`[配置告警] 设备 ${authDeviceId} 上报的 device_Id 为 ${deviceId}，与认证身份不一致`);
            }

            const serverUid = String(data.server_Uid ?? '').trim();
            const serverKey = String(data.server_key ?? '').trim();
            const corpId = String(data.corp_Id ?? '').trim();

            await dbWithRetry(`
                INSERT INTO client_config (master, device_Id, server_Uid, server_key, corp_Id)
                VALUES (:master, :deviceId, :serverUid, :serverKey, :corpId)
                ON DUPLICATE KEY UPDATE
                    device_Id = :deviceId,
                    server_Uid = :serverUid,
                    server_key = :serverKey,
                    corp_Id = :corpId,
                    updated_at = NOW()
            `, { master, deviceId, serverUid, serverKey, corpId });

            console.log(`[配置] 使用人 ${master} / 设备 ${deviceId} 的配置已保存`);
            socket.emit('config_saved', { master, device_Id: deviceId, serverTime: Date.now() });
        } catch (err) {
            console.error(`[配置错误] 设备 ${authDeviceId} 配置上报处理失败:`, err.message);
            socket.emit('config_fail', { reason: err.message });
        }
    });

    // 监听断开连接事件 - 优化清理逻辑
    socket.on('disconnect', (reason) => {
        const deviceId = socket.deviceId;
        const master = socket.master;

        let disconnectReason = `连接关闭 (reason: ${reason})`;
        if (reason === 'transport close') disconnectReason = '异常断开（网络中断/客户端崩溃）';
        if (reason === 'ping timeout') disconnectReason = '心跳超时';
        if (reason === 'forced close') disconnectReason = '被服务器强制关闭';

        console.log(`[断开] 客户端 ${deviceId || socket.id} (${master || '未认证'}) 断开连接。原因: ${disconnectReason}`);

        // 检查是否为重连过程中的正常断开
        if (socket.isReconnecting || socket.willReconnect) {
            console.log(`[重连断开] 设备 ${deviceId} 为重连过程中的正常断开，跳过清理`);
            return;
        }

        // 清理资源（传入当前 socket 做身份校验，避免旧连接误删新连接）
        cleanupClient(deviceId, disconnectReason, socket);
    });

    // 监听错误事件
    socket.on('error', (err) => {
        const deviceId = socket.deviceId || socket.id;
        console.error(`[Socket错误] 客户端 ${deviceId} 发生错误:`, err.message);
        cleanupClient(deviceId, `Socket错误: ${err.message}`, socket);
    });
});

// ==========================
// 全局客户端状态巡检
// ==========================
setInterval(async () => {
    console.log(`[巡检] 开始全局客户端状态巡检。当前内存中在线设备数: ${clients.size}`);

    try {
        const [dbOnlineClients] = await dbWithRetry(`
            SELECT device_id, last_active_at FROM clients WHERE status = 'online'
        `);

        console.log(`[巡检] 数据库中标记为 online 的设备数: ${dbOnlineClients.length}`);

        const dbOnlineSet = new Set(dbOnlineClients.map((c) => c.device_id));

        // 方向一：数据库为 online 但内存中无连接（如服务器重启后残留）→ 修正为 offline
        for (const dbClient of dbOnlineClients) {
            const deviceId = dbClient.device_id;
            if (!clients.has(deviceId)) {
                console.warn(`[巡检] 发现不一致: 设备 ${deviceId} 在数据库中为 online，但内存中无连接。正在修正为 offline。`);
                await dbWithRetry(`
                    UPDATE clients
                    SET status = 'offline', updated_at = NOW(), last_offline_at = NOW()
                    WHERE device_id = :deviceId
                `, { deviceId });
            }
        }

        // 方向二：内存中存在活跃连接但数据库未标记 online（如旧连接断开误改、连接时漏写）→ 回写为 online
        for (const [deviceId, socket] of clients) {
            if (!socket || !socket.connected) continue; // 跳过失效连接，交由清理逻辑处理
            if (!dbOnlineSet.has(deviceId)) {
                console.warn(`[巡检] 发现不一致: 设备 ${deviceId} 内存中在线，但数据库未标记 online。正在回写为 online。`);
                await dbWithRetry(`
                    UPDATE clients
                    SET status = 'online', updated_at = NOW(), last_active_at = NOW(), last_offline_at = NULL
                    WHERE device_id = :deviceId
                `, { deviceId });
            }
        }

    } catch (err) {
        console.error('[巡检错误] 全局巡检过程中发生数据库错误:', err.message);
    }

    console.log(`[巡检] 巡检完成。当前内存中在线设备数: ${clients.size}`);
}, 300000); // 每5分钟巡检一次

// ==========================
// 服务启动和优雅关闭
// ==========================
const PORT = config.port;

async function startServer() {
    try {
        await testDbConnection();
        await ensureUsersTable();
        await ensureClientColumns();
        await ensureScheduledTasksTable();
        await ensureClientConfigTable();
        await ensureClientAuthTokensTable();

        if (!fsSync.existsSync(LOG_ROOT)) {
            fsSync.mkdirSync(LOG_ROOT, { recursive: true });
        }

        server.listen(PORT, () => {
            console.log(`服务运行在 http://localhost:${PORT}`);
            console.log(`Socket.io 服务已启动，监听端口 ${PORT}`);
            // 启动定时任务调度器（此时 clientStore 已 init）
            startScheduler();
        });

    } catch (error) {
        console.error('服务启动失败:', error.message);
        process.exit(1);
    }
}

// 优雅关闭
process.on('SIGINT', async () => {
    console.log('\n收到关闭信号，正在优雅退出...');

    // 1. 断开所有 socket 连接
    io.disconnectSockets(true);
    console.log('所有 Socket 连接已断开');

    // 2. 批量更新数据库中所有在线客户端为离线
    try {
        await dbWithRetry(`
            UPDATE clients
            SET status = 'offline', updated_at = NOW(), last_offline_at = NOW()
            WHERE status = 'online'
        `);
        console.log('数据库批量更新：所有在线客户端已设为离线');
    } catch (err) {
        console.error('优雅关闭数据库错误:', err.message);
    }

    // 3. 关闭数据库连接池
    await dbPool.end();
    console.log('数据库连接池已关闭');

    console.log('优雅退出完成');
    process.exit(0);
});

startServer();
