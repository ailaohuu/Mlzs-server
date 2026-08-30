// ==========================
// 定时任务调度器
// 每分钟巡检一次 scheduled_tasks，到点经 Socket.io 下发 notification。
// 工作日规则：周期性任务（daily/weekly）仅在工作日触发（含调休补班，跳过周末+法定节假日）。
// 一次性任务（once）按用户指定的具体时间触发，不套工作日过滤；服务停机错过的会在恢复后补发一次。
// ==========================
const { dbWithRetry } = require('./db');
const clientStore = require('./clientStore');

// 离线节假日库（覆盖 2004-2026，含调休）。加载失败则退化为"周末即非工作日"。
let isWorkday;
try {
    const chineseDays = require('chinese-days');
    isWorkday = chineseDays.isWorkday;
    if (typeof isWorkday !== 'function') throw new Error('isWorkday 不可用');
} catch (err) {
    console.warn('[调度器] 未能加载 chinese-days，工作日判断退化为仅排除周末:', err.message);
    isWorkday = (dateStr) => {
        const d = new Date(dateStr + 'T00:00:00');
        const wd = d.getDay();
        return wd !== 0 && wd !== 6;
    };
}

const pad = (n) => String(n).padStart(2, '0');

// 将 Date 或字符串格式化为本地 'YYYY-MM-DD'
function toDateStr(value) {
    if (!value) return '';
    if (value instanceof Date) {
        return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
    }
    // 字符串：截取前 10 位（兼容 'YYYY-MM-DD' 或 'YYYY-MM-DD HH:MM:SS'）
    return String(value).slice(0, 10);
}

// 本地 'YYYY-MM-DD HH:MM:SS'
function toDateTimeStr(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
        `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// 判断该任务此刻是否应触发
function isDue(task, now, todayStr, hhmm, weekday) {
    if (task.type === 'once') {
        if (task.status !== 'pending') return false;
        const dateStr = toDateStr(task.fire_date);
        if (!dateStr) return false;
        // 精确命中当前分钟，或已过期补发
        if (dateStr === todayStr && task.fire_time === hhmm) return true;
        const scheduled = new Date(`${dateStr}T${task.fire_time}:00`);
        return scheduled.getTime() <= now.getTime();
    }

    // 周期性：必须是工作日
    if (!isWorkday(todayStr)) return false;
    if (task.fire_time !== hhmm) return false;

    if (task.type === 'daily') return true;

    if (task.type === 'weekly') {
        const days = String(task.weekdays || '')
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s !== '');
        return days.includes(String(weekday));
    }

    return false;
}

// 同一分钟内已触发过则跳过（去重）
function firedThisMinute(task, now) {
    if (!task.last_fired_at) return false;
    const last = task.last_fired_at instanceof Date ? task.last_fired_at : new Date(task.last_fired_at);
    if (Number.isNaN(last.getTime())) return false;
    return last.getFullYear() === now.getFullYear()
        && last.getMonth() === now.getMonth()
        && last.getDate() === now.getDate()
        && last.getHours() === now.getHours()
        && last.getMinutes() === now.getMinutes();
}

async function fireTask(task, now) {
    // 走 /send-message 同款通道：emit 'message' 事件，内容为任务文本（设备端已监听 'message'）
    const result = clientStore.sendMessage(task.device_id, task.message);
    const delivered = result.status === 200;

    if (delivered) {
        console.log(`[调度器] 任务 #${task.id}「${task.name}」已下发到设备 ${task.device_id}`);
    } else {
        console.warn(`[调度器] 任务 #${task.id}「${task.name}」下发失败：设备 ${task.device_id} 不在线`);
    }

    // 更新触发时间 / 状态
    const fields = ['last_fired_at = :firedAt'];
    const params = { id: task.id, firedAt: toDateTimeStr(now) };
    if (task.type === 'once') {
        fields.push('status = :status');
        params.status = delivered ? 'done' : 'missed';
    }
    await dbWithRetry(
        `UPDATE scheduled_tasks SET ${fields.join(', ')} WHERE id = :id`,
        params
    );
}

async function tick() {
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const hhmm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const weekday = now.getDay(); // 0=周日..6=周六

    let tasks;
    try {
        [tasks] = await dbWithRetry(
            `SELECT id, device_id, master, name, message, type, fire_time, fire_date,
                    weekdays, status, last_fired_at
             FROM scheduled_tasks
             WHERE enabled = 1 AND status != 'done'`
        );
    } catch (err) {
        console.error('[调度器] 读取任务失败:', err.message);
        return;
    }

    for (const task of tasks) {
        try {
            if (!isDue(task, now, todayStr, hhmm, weekday)) continue;
            if (firedThisMinute(task, now)) continue;
            await fireTask(task, now);
        } catch (err) {
            console.error(`[调度器] 任务 #${task.id} 处理出错:`, err.message);
        }
    }
}

function startScheduler() {
    // 对齐到下一个整分钟再开始，之后每 60 秒一次
    const now = new Date();
    const msToNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds();
    setTimeout(() => {
        tick();
        setInterval(tick, 60 * 1000);
    }, Math.max(0, msToNextMinute));
    console.log('定时任务调度器已启动（每分钟巡检一次）');
}

module.exports = { startScheduler, tick, isDue };
