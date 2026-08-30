// ==========================
// 配置加载：从 .env 读取并导出强类型配置对象
// ==========================
require('dotenv').config();

// 校验必填项
const REQUIRED = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
const missing = REQUIRED.filter((key) => !process.env[key]);
if (missing.length > 0) {
    console.error(`[配置错误] .env 缺少必填项: ${missing.join(', ')}`);
    console.error('请参考 .env.example 创建 .env 文件。');
    process.exit(1);
}

const toInt = (val, fallback) => {
    const n = parseInt(val, 10);
    return Number.isFinite(n) ? n : fallback;
};

const config = {
    db: {
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        port: toInt(process.env.DB_PORT, 3306),
        connectionLimit: toInt(process.env.DB_CONNECTION_LIMIT, 30),
    },
    port: toInt(process.env.PORT, 7011),
    // 客户端 token 加密密钥；生产环境建议通过 TOKEN_SECRET 固定配置
    tokenSecret: process.env.TOKEN_SECRET || `client-auth:${process.env.DB_USER}:${process.env.DB_PASSWORD}:${process.env.DB_NAME}`,
    // 逗号分隔的来源列表；为空则视为允许同源（不限制）
    corsOrigins: (process.env.CORS_ORIGINS || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
};

module.exports = config;
