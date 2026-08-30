const mysql = require('mysql2/promise');
const config = require('./config');

// ==========================
// 数据库连接池
// ==========================
const dbConfig = {
    host: config.db.host,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    port: config.db.port,
    waitForConnections: true,
    connectionLimit: config.db.connectionLimit,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 30000,
    namedPlaceholders: true,
    decimalNumbers: true,
    connectTimeout: 5000,
};

const dbPool = mysql.createPool(dbConfig);

// 数据库操作重试函数
async function dbWithRetry(query, params, retryCount = 3) {
    let attempt = 0;
    while (attempt < retryCount) {
        try {
            return await dbPool.query(query, params);
        } catch (err) {
            attempt++;
            console.warn(`数据库操作失败（第 ${attempt} 次重试）:`, err.message);
            if (attempt >= retryCount) throw err;
            await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
        }
    }
}

// 测试数据库连接
async function testDbConnection() {
    try {
        await dbWithRetry('SELECT 1');
        console.log('数据库连接成功');
    } catch (err) {
        console.error('数据库连接失败:', err.message);
        process.exit(1);
    }
}

// 确保 clients 表存在电量/充电状态列（不存在则自动添加）
async function ensureClientColumns() {
    const columns = [
        { name: 'battery_level', ddl: 'ADD COLUMN battery_level TINYINT UNSIGNED NULL' },
        { name: 'charging', ddl: 'ADD COLUMN charging TINYINT(1) NULL' },
        { name: 'listening', ddl: 'ADD COLUMN listening TINYINT(1) NULL' },
    ];
    for (const col of columns) {
        try {
            const [rows] = await dbWithRetry(
                `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'clients' AND COLUMN_NAME = :col`,
                { col: col.name }
            );
            if (rows.length === 0) {
                await dbWithRetry(`ALTER TABLE clients ${col.ddl}`);
                console.log(`[迁移] clients 表已添加列 ${col.name}`);
            }
        } catch (err) {
            console.error(`[迁移错误] 检查/添加列 ${col.name} 失败:`, err.message);
        }
    }
}

// 确保定时任务表存在
async function ensureScheduledTasksTable() {
    try {
        await dbWithRetry(`
            CREATE TABLE IF NOT EXISTS scheduled_tasks (
                id INT AUTO_INCREMENT PRIMARY KEY,
                device_id VARCHAR(190) NOT NULL,
                master VARCHAR(190) NOT NULL DEFAULT '',
                name VARCHAR(190) NOT NULL,
                message TEXT NOT NULL,
                type ENUM('once', 'daily', 'weekly') NOT NULL DEFAULT 'daily',
                fire_time VARCHAR(5) NOT NULL,
                fire_date DATE NULL,
                weekdays VARCHAR(20) NULL,
                enabled TINYINT(1) NOT NULL DEFAULT 1,
                status ENUM('pending', 'done', 'missed') NOT NULL DEFAULT 'pending',
                last_fired_at DATETIME NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_device (device_id),
                INDEX idx_enabled (enabled)
            )
        `);
    } catch (err) {
        console.error('[迁移错误] 创建 scheduled_tasks 表失败:', err.message);
    }
}

// 确保客户端配置表存在，且字段类型可用
// 该表最初五列均以 int(11) 建立，无法存放使用人姓名、推送Key、钉钉ID 等字符串
// （库开启了 STRICT_TRANS_TABLES，写入会直接报错），这里统一纠正为 VARCHAR
async function ensureClientConfigTable() {
    // 全新部署：直接建成目标结构
    try {
        await dbWithRetry(`
            CREATE TABLE IF NOT EXISTS client_config (
                master VARCHAR(64) NOT NULL,
                device_Id VARCHAR(32) NOT NULL,
                server_Uid VARCHAR(128) NOT NULL DEFAULT '',
                server_key VARCHAR(255) NOT NULL DEFAULT '',
                corp_Id VARCHAR(128) NOT NULL DEFAULT '',
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (master),
                INDEX idx_device (device_Id)
            )
        `);
    } catch (err) {
        console.error('[迁移错误] 创建 client_config 表失败:', err.message);
        return;
    }

    // 已存在的表：缺列则补，列类型不符则改正
    // 注意必须比对完整的 COLUMN_TYPE（含长度），只比 DATA_TYPE 会把 varchar(11)
    // 这类长度不足的列误判为“已正确”，从而永远不会被修正
    const columns = [
        { name: 'master', columnType: 'varchar(64)', ddl: 'VARCHAR(64) NOT NULL' },
        { name: 'device_Id', columnType: 'varchar(32)', ddl: 'VARCHAR(32) NOT NULL' },
        { name: 'server_Uid', columnType: 'varchar(128)', ddl: "VARCHAR(128) NOT NULL DEFAULT ''" },
        { name: 'server_key', columnType: 'varchar(255)', ddl: "VARCHAR(255) NOT NULL DEFAULT ''" },
        { name: 'corp_Id', columnType: 'varchar(128)', ddl: "VARCHAR(128) NOT NULL DEFAULT ''" },
        { name: 'updated_at', columnType: 'timestamp', ddl: 'TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP' },
    ];
    for (const col of columns) {
        try {
            const [rows] = await dbWithRetry(
                `SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_config' AND COLUMN_NAME = :col`,
                { col: col.name }
            );
            if (rows.length === 0) {
                await dbWithRetry(`ALTER TABLE client_config ADD COLUMN \`${col.name}\` ${col.ddl}`);
                console.log(`[迁移] client_config 表已添加列 ${col.name} ${col.columnType}`);
                continue;
            }
            const actual = String(rows[0].COLUMN_TYPE).toLowerCase();
            if (actual !== col.columnType) {
                await dbWithRetry(`ALTER TABLE client_config MODIFY COLUMN \`${col.name}\` ${col.ddl}`);
                console.log(`[迁移] client_config 表列 ${col.name} 已由 ${actual} 改为 ${col.columnType}`);
            }
        } catch (err) {
            console.error(`[迁移错误] 检查/修正列 ${col.name} 失败:`, err.message);
        }
    }

    // 按设备反查配置用的索引
    try {
        const [idx] = await dbWithRetry(
            `SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_config' AND INDEX_NAME = 'idx_device'`
        );
        if (idx.length === 0) {
            await dbWithRetry('ALTER TABLE client_config ADD INDEX idx_device (device_Id)');
            console.log('[迁移] client_config 表已添加索引 idx_device');
        }
    } catch (err) {
        console.error('[迁移错误] 检查/添加索引 idx_device 失败:', err.message);
    }
}

// 确保客户端长期登录 token 表存在
async function ensureClientAuthTokensTable() {
    try {
        await dbWithRetry(`
            CREATE TABLE IF NOT EXISTS client_auth_tokens (
                id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                token_hash CHAR(64) NOT NULL,
                token_encrypted TEXT NULL,
                expires_at DATETIME NOT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                last_used_at DATETIME NULL,
                revoked_at DATETIME NULL,
                UNIQUE KEY uq_token_hash (token_hash),
                INDEX idx_user_id (user_id),
                INDEX idx_token_status (token_hash, revoked_at, expires_at),
                INDEX idx_expires_at (expires_at)
            )
        `);
    } catch (err) {
        console.error('[迁移错误] 创建 client_auth_tokens 表失败:', err.message);
        return;
    }

    // 为已有 token 表补充可逆密文列，用于重复登录时返回原 token
    try {
        const [columns] = await dbWithRetry(
            `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_auth_tokens'
               AND COLUMN_NAME = 'token_encrypted'`
        );
        if (columns.length === 0) {
            await dbWithRetry('ALTER TABLE client_auth_tokens ADD COLUMN token_encrypted TEXT NULL AFTER token_hash');
            console.log('[迁移] client_auth_tokens 表已添加列 token_encrypted');
        }
    } catch (err) {
        console.error('[迁移错误] 检查/添加 token_encrypted 列失败:', err.message);
    }
}

module.exports = {
    dbPool,
    dbWithRetry,
    testDbConnection,
    ensureClientColumns,
    ensureScheduledTasksTable,
    ensureClientConfigTable,
    ensureClientAuthTokensTable,
};
