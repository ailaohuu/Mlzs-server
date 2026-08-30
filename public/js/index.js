// 设备监控中心（普通用户）页面逻辑（index.html）
// 注意：本文件以传统脚本方式加载（非 type="module"），
// 因为 index.html 中的 onclick 内联处理器依赖 logout / openTaskModal 等全局函数。

let currentUser = null;
let activeDevice = null;
let deviceTimer = null;
let logTimer = null;

// 页面加载验证登录
window.onload = () => {
  const userStr = sessionStorage.getItem('user');
  if (!userStr) {
    window.location.href = 'login.html';
    return;
  }

  try {
    const userData = JSON.parse(userStr);

    // 如果是管理员，跳转到管理员页面
    if (userData.role === 'admin') {
      window.location.href = 'admin.html';
      return;
    }

    // 验证登录有效性
    // 添加时间戳防止缓存
    const timestamp = new Date().getTime();
    fetch(`auth?action=check&_=${timestamp}`, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        'Pragma': 'no-cache'
      },
      body: `user=${encodeURIComponent(userStr)}`
    })
    .then(res => res.json())
    .then(data => {
      if (!data.success) {
        sessionStorage.removeItem('user');
        window.location.href = 'login.html';
        return;
      }

      // 登录有效，初始化页面
      currentUser = userData;
      initPage();
    })
    .catch(() => {
      alert('登录验证失败，请重新登录');
      sessionStorage.removeItem('user');
      window.location.href = 'login.html';
    });
  } catch (e) {
    alert('用户信息格式错误');
    sessionStorage.removeItem('user');
    window.location.href = 'login.html';
  }
};

// 初始化页面
function initPage() {
  // 显示用户信息
  document.getElementById('userInfo').textContent =
    `${currentUser.username}（${currentUser.role === 'admin' ? '管理员' : '普通用户'}）`;

  // 更新系统时间
  updateSystemTime();
  setInterval(updateSystemTime, 1000);

  // 加载设备列表
  loadDevices();
  deviceTimer = setInterval(loadDevices, 5000);
}

// 加载设备列表
function loadDevices() {
  // 添加时间戳防止缓存
  const timestamp = new Date().getTime();

  // 管理员看所有设备，普通用户只看自己的
  let url = currentUser.role === 'admin'
    ? `device_list.php?_=${timestamp}`
    : `device_list.php?master=${encodeURIComponent(currentUser.realname)}&_=${timestamp}`;

  fetch(url, {
    method: 'GET',
    cache: 'no-store',
    headers: {
      'Accept': 'application/json',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'Pragma': 'no-cache'
    }
  })
    .then(res => {
      // 检查响应状态
      if (!res.ok) {
        throw new Error(`HTTP错误! 状态: ${res.status}`);
      }
      return res.json();
    })
    .then(data => {
      const container = document.getElementById('deviceList');
      container.innerHTML = '';

      if (data.error) {
        container.innerHTML = `<div class="col-span-full p-4 text-center text-red-500">${data.error}</div>`;
        return;
      }

      if (data.devices.length === 0) {
        container.innerHTML = `
          <div class="col-span-full p-6 text-center text-gray-500">
            <i class="fa fa-wifi text-gray-300 text-xl mb-2"></i>
            <p>暂无在线设备</p>
          </div>
        `;
        return;
      }

      // 生成设备卡片
      data.devices.forEach(device => {
        const isActive = activeDevice && activeDevice.device_id === device.device_id;
        const card = document.createElement('div');
        card.className = `device-card ${isActive ? 'active' : 'border-gray-200 bg-white'}`;
        card.onclick = () => selectDevice(device);

        card.innerHTML = `
          <div class="flex justify-between items-start mb-2">
            <div class="flex items-center">
              <span class="w-2.5 h-2.5 rounded-full bg-success pulse mr-2"></span>
              <span class="font-medium text-sm">${device.device_id}</span>
            </div>
            <div class="flex items-center gap-1">
              <button class="text-xs text-primary hover:text-blue-700 p-1" title="定时任务" onclick="event.stopPropagation(); openTaskModal('${device.device_id}', '${device.master}')"><i class="fa fa-clock-o"></i></button>
              <span class="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded">在线</span>
              ${renderListening(device)}
            </div>
          </div>
          <div class="text-xs text-gray-500 space-y-1">
            <p><i class="fa fa-user w-4 mr-1 text-gray-400"></i>${device.master}</p>
            <p><i class="fa fa-user w-4 mr-1 text-gray-400"></i>${device.client_version}</p>
            ${renderBattery(device)}
            <p><i class="fa fa-clock-o w-4 mr-1 text-gray-400"></i>${formatTime(device.updated_at)}</p>
          </div>
          ${isActive ? `<div class="mt-2 text-xs text-primary text-center">已选中</div>` : ''}
        `;
        container.appendChild(card);
      });
    })
    .catch(err => {
      document.getElementById('deviceList').innerHTML =
        `<div class="col-span-full p-4 text-center text-red-500">加载设备失败：${err.message}</div>`;
    });
}

// 选择设备查看日志
function selectDevice(device) {
  activeDevice = device;
  document.getElementById('currentDevice').textContent = `设备：${device.device_id}（${device.master}）`;

  // 加载日志
  loadLogs(device.master);

  // 重置日志定时器
  if (logTimer) clearInterval(logTimer);
  logTimer = setInterval(() => loadLogs(device.master), 3000);

  // 重新渲染设备列表（更新选中状态）
  loadDevices();
}

// 加载日志
function loadLogs(master) {
  // 添加时间戳防止缓存
  const timestamp = new Date().getTime();
  fetch(`log_list.php?master=${encodeURIComponent(master)}&_=${timestamp}`, {
    method: 'GET',
    cache: 'no-store',
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'Pragma': 'no-cache'
    }
  })
    .then(res => {
      // 检查响应状态
      if (!res.ok) {
        throw new Error(`HTTP错误! 状态: ${res.status}`);
      }
      // 检查响应内容类型
      const contentType = res.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        return res.json().then(jsonData => {
          // 处理JSON格式的日志响应
          if (jsonData.logs && Array.isArray(jsonData.logs)) {
            return jsonData.logs.join('\n') || '该设备暂无日志记录';
          } else if (jsonData.message) {
            return jsonData.message;
          } else if (jsonData.error) {
            throw new Error(jsonData.error);
          }
          return '该设备暂无日志记录';
        });
      }
      return res.text();
    })
    .then(text => {
      const logEl = document.getElementById('logContent');
      logEl.textContent = text || '该设备暂无日志记录';
      document.getElementById('logUpdateTime').textContent = `最后更新：${new Date().toLocaleTimeString()}`;
    })
    .catch(err => {
      document.getElementById('logContent').textContent = `加载日志失败：${err.message}`;
    });
}

// 退出登录
function logout() {
  if (confirm('确定要退出登录吗？')) {
    // 登录态存放在 sessionStorage（见 login.js），这里必须清同一处
    sessionStorage.removeItem('user');
    window.location.href = 'login.html';
  }
}

// 辅助函数：格式化时间
function formatTime(timeStr) {
  const date = new Date(timeStr);
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

// 渲染电量与充电状态（设备卡片用）
function renderBattery(device) {
  const raw = device.battery_level;
  const isCharging = device.charging == 1 || device.charging === true;
  if (raw === null || raw === undefined || raw === '') {
    return `<p><i class="fa fa-battery-empty w-4 mr-1 text-gray-300"></i>电量未知</p>`;
  }
  const level = Math.max(0, Math.min(100, parseInt(raw, 10)));
  // 按电量选择图标与颜色
  let icon = 'fa-battery-full', color = 'text-green-500';
  if (level <= 10) { icon = 'fa-battery-empty'; color = 'text-red-500'; }
  else if (level <= 35) { icon = 'fa-battery-quarter'; color = 'text-red-500'; }
  else if (level <= 60) { icon = 'fa-battery-half'; color = 'text-yellow-500'; }
  else if (level <= 85) { icon = 'fa-battery-three-quarters'; color = 'text-green-500'; }
  const bolt = isCharging ? ` <i class="fa fa-bolt text-yellow-500" title="充电中"></i><span class="text-green-600">充电中</span>` : '';
  return `<p><i class="fa ${icon} w-4 mr-1 ${color}"></i>${level}%${bolt}</p>`;
}

// 渲染监听状态标签（设备卡片右上角用）
function renderListening(device) {
  const isListening = device.listening == 1 || device.listening === true;
  if (isListening) {
    return `<span class="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded"><i class="fa fa-eye mr-0.5"></i>监听中</span>`;
  }
  return `<span class="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded"><i class="fa fa-eye-slash mr-0.5"></i>未监听</span>`;
}

// ==== 定时任务弹窗（按设备） ====
function openTaskModal(deviceId, master) {
  const modal = document.createElement('div');
  modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4';
  modal.innerHTML = `
    <div class="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
      <div class="flex justify-between items-center px-5 py-3 border-b">
        <h3 class="font-semibold text-gray-800"><i class="fa fa-clock-o mr-1 text-primary"></i>定时任务 · ${deviceId}</h3>
        <button class="close-btn text-gray-400 hover:text-gray-600"><i class="fa fa-times"></i></button>
      </div>
      <div class="p-5 overflow-y-auto">
        <div id="taskListBox" class="space-y-2 mb-4 text-sm text-gray-500">加载中...</div>
        <form class="task-form border-t pt-4 space-y-3">
          <div>
            <label class="block text-xs text-gray-500 mb-1">任务名称</label>
            <input name="name" required maxlength="50" class="w-full border rounded px-2 py-1.5 text-sm" placeholder="如：上班打卡提醒">
          </div>
          <div>
            <label class="block text-xs text-gray-500 mb-1">通知内容</label>
            <input name="message" required maxlength="200" class="w-full border rounded px-2 py-1.5 text-sm" placeholder="下发给设备的通知文本">
          </div>
          <div class="flex gap-2">
            <div class="flex-1">
              <label class="block text-xs text-gray-500 mb-1">类型</label>
              <select name="type" class="task-type w-full border rounded px-2 py-1.5 text-sm">
                <option value="daily">每天</option>
                <option value="weekly">每周</option>
                <option value="once">一次性</option>
              </select>
            </div>
            <div class="flex-1">
              <label class="block text-xs text-gray-500 mb-1">时间</label>
              <input type="time" name="fire_time" required class="w-full border rounded px-2 py-1.5 text-sm">
            </div>
          </div>
          <div class="task-date hidden">
            <label class="block text-xs text-gray-500 mb-1">日期</label>
            <input type="date" name="fire_date" class="w-full border rounded px-2 py-1.5 text-sm">
          </div>
          <div class="task-weekdays hidden">
            <label class="block text-xs text-gray-500 mb-1">星期</label>
            <div class="flex flex-wrap gap-2 text-xs">
              ${[[1,'一'],[2,'二'],[3,'三'],[4,'四'],[5,'五'],[6,'六'],[0,'日']].map(d=>`<label class="inline-flex items-center gap-1"><input type="checkbox" class="wd" value="${d[0]}">周${d[1]}</label>`).join('')}
            </div>
          </div>
          <p class="text-xs text-gray-400">周期性任务仅在工作日触发（自动跳过周末和法定节假日，含调休补班）。</p>
          <div class="task-msg text-center text-sm"></div>
          <button type="submit" class="w-full bg-primary text-white rounded py-2 text-sm hover:opacity-90">创建任务</button>
        </form>
      </div>
    </div>`;
  document.body.appendChild(modal);

  const close = () => document.body.removeChild(modal);
  modal.querySelector('.close-btn').addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

  const typeSel = modal.querySelector('.task-type');
  const dateBox = modal.querySelector('.task-date');
  const wdBox = modal.querySelector('.task-weekdays');
  typeSel.addEventListener('change', () => {
    dateBox.classList.toggle('hidden', typeSel.value !== 'once');
    wdBox.classList.toggle('hidden', typeSel.value !== 'weekly');
  });

  const listEl = modal.querySelector('#taskListBox');
  const msgEl = modal.querySelector('.task-msg');
  const typeName = { once: '一次性', daily: '每天', weekly: '每周' };
  const statusName = { pending: '待触发', done: '已完成', missed: '未送达' };
  const wdName = ['日', '一', '二', '三', '四', '五', '六'];

  function showMsg(text, ok) {
    msgEl.textContent = text;
    msgEl.className = 'task-msg text-center text-sm ' + (ok ? 'text-green-600' : 'text-red-600');
  }

  function describe(t) {
    if (t.type === 'weekly') {
      const days = String(t.weekdays || '').split(',').filter(s => s !== '').map(n => '周' + wdName[n]).join(' ');
      return `每周 ${days} ${t.fire_time}`;
    }
    if (t.type === 'once') return `${String(t.fire_date).slice(0, 10)} ${t.fire_time}`;
    return `每天 ${t.fire_time}`;
  }

  function loadTaskList() {
    const ts = Date.now();
    fetch(`task_management.php?action=list&device_id=${encodeURIComponent(deviceId)}&master=${encodeURIComponent(master)}&_=${ts}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(data => {
        const tasks = data.tasks || [];
        if (!tasks.length) { listEl.innerHTML = '<p class="text-gray-400">暂无定时任务</p>'; return; }
        listEl.innerHTML = tasks.map(t => `
          <div class="border rounded px-3 py-2 flex justify-between items-center ${t.enabled == 1 ? '' : 'opacity-50'}">
            <div class="min-w-0">
              <p class="font-medium text-gray-800 text-sm truncate">${t.name} <span class="text-xs text-gray-400">[${typeName[t.type] || t.type}]</span></p>
              <p class="text-xs text-gray-500 truncate">${describe(t)} · ${t.message}</p>
              ${t.type === 'once' ? `<p class="text-xs text-gray-400">状态：${statusName[t.status] || t.status}</p>` : ''}
            </div>
            <div class="flex items-center gap-2 shrink-0 ml-2">
              <button data-toggle="${t.id}" data-enabled="${t.enabled}" class="text-xs ${t.enabled == 1 ? 'text-yellow-600' : 'text-green-600'}">${t.enabled == 1 ? '停用' : '启用'}</button>
              <button data-del="${t.id}" class="text-xs text-red-500"><i class="fa fa-trash-o"></i></button>
            </div>
          </div>`).join('');
      })
      .catch(() => { listEl.innerHTML = '<p class="text-red-500">加载任务失败</p>'; });
  }

  listEl.addEventListener('click', (e) => {
    const delBtn = e.target.closest('[data-del]');
    const tgBtn = e.target.closest('[data-toggle]');
    if (delBtn) {
      if (!confirm('确定删除该任务？')) return;
      fetch('task_management.php?action=delete', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'id=' + delBtn.getAttribute('data-del') })
        .then(r => r.json()).then(() => loadTaskList());
    } else if (tgBtn) {
      const next = tgBtn.getAttribute('data-enabled') === '1' ? 0 : 1;
      fetch('task_management.php?action=toggle', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `id=${tgBtn.getAttribute('data-toggle')}&enabled=${next}` })
        .then(r => r.json()).then(() => loadTaskList());
    }
  });

  modal.querySelector('.task-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const els = e.target.elements;
    const type = els['type'].value;
    const params = new URLSearchParams();
    params.set('device_id', deviceId);
    params.set('master', master);
    params.set('name', els['name'].value.trim());
    params.set('message', els['message'].value.trim());
    params.set('type', type);
    params.set('fire_time', els['fire_time'].value);
    if (type === 'once') params.set('fire_date', els['fire_date'].value);
    if (type === 'weekly') {
      params.set('weekdays', [...modal.querySelectorAll('.wd:checked')].map(c => c.value).join(','));
    }
    fetch('task_management.php?action=add', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params })
      .then(r => r.json())
      .then(data => {
        showMsg(data.msg || '操作完成', !!data.success);
        if (data.success) { e.target.reset(); dateBox.classList.add('hidden'); wdBox.classList.add('hidden'); loadTaskList(); }
      })
      .catch(() => showMsg('创建失败，请重试', false));
  });

  loadTaskList();
}

// 更新系统时间
function updateSystemTime() {
  const now = new Date();
  document.getElementById('systemTime').textContent =
    now.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
}

// 页面关闭清理定时器
window.onbeforeunload = () => {
  if (deviceTimer) clearInterval(deviceTimer);
  if (logTimer) clearInterval(logTimer);
};

// 密码修改相关功能
const changePasswordModal = document.createElement('div');
changePasswordModal.id = 'changePasswordModal';
changePasswordModal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 hidden';
changePasswordModal.innerHTML = `
  <div class="bg-white rounded-lg shadow-xl w-full max-w-md p-6">
    <div class="flex justify-between items-center mb-4">
      <h3 class="text-lg font-bold text-gray-800">修改密码</h3>
      <button id="closeModalBtn" class="text-gray-500 hover:text-gray-700">&times;</button>
    </div>
    <form id="changePasswordForm" class="space-y-4">
      <input type="hidden" id="changeUsername" value="">
      <div>
        <label for="currentPwd" class="block text-sm font-medium text-gray-700">当前密码</label>
        <input type="password" id="currentPwd" name="currentPwd" class="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" required>
      </div>
      <div>
        <label for="newPwd" class="block text-sm font-medium text-gray-700">新密码</label>
        <input type="password" id="newPwd" name="newPwd" class="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" required>
        <p class="mt-1 text-xs text-gray-500">密码长度至少6位</p>
      </div>
      <div>
        <label for="confirmPwd" class="block text-sm font-medium text-gray-700">确认新密码</label>
        <input type="password" id="confirmPwd" class="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" required>
      </div>
      <div class="pt-2">
        <button type="submit" class="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500">保存修改</button>
      </div>
    </form>
    <div id="passwordMessage" class="mt-4 text-center text-sm hidden"></div>
  </div>
`;
document.body.appendChild(changePasswordModal);

const closeModalBtn = document.getElementById('closeModalBtn');
const changePasswordForm = document.getElementById('changePasswordForm');
const changeUsername = document.getElementById('changeUsername');
const passwordMessage = document.getElementById('passwordMessage');

// 显示修改密码模态框
document.getElementById('changePasswordBtn').addEventListener('click', () => {
  if (currentUser) {
    changeUsername.value = currentUser.username;
    changePasswordModal.classList.remove('hidden');
    // 重置表单和消息
    changePasswordForm.reset();
    passwordMessage.textContent = '';
    passwordMessage.classList.add('hidden');
  }
});

// 关闭模态框
closeModalBtn.addEventListener('click', () => {
  changePasswordModal.classList.add('hidden');
});

// 点击模态框外部关闭
changePasswordModal.addEventListener('click', (e) => {
  if (e.target === changePasswordModal) {
    changePasswordModal.classList.add('hidden');
  }
});

// 处理密码修改表单提交
changePasswordForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const username = changeUsername.value;
  const currentPwd = document.getElementById('currentPwd').value;
  const newPwd = document.getElementById('newPwd').value;
  const confirmPwd = document.getElementById('confirmPwd').value;

  // 验证两次输入的新密码是否一致
  if (newPwd !== confirmPwd) {
    showPasswordMessage('两次输入的新密码不一致', 'error');
    return;
  }

  try {
    // 添加时间戳防止缓存
    const timestamp = new Date().getTime();
    const response = await fetch(`auth?action=changePassword&_=${timestamp}`, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        'Pragma': 'no-cache'
      },
      body: `user=${encodeURIComponent(username)}&currentPwd=${encodeURIComponent(currentPwd)}&newPwd=${encodeURIComponent(newPwd)}`
    });

    // 直接使用json()方法获取响应，不再记录原始响应文本
    try {
      const result = await response.json();

      if (result.success) {
        showPasswordMessage(result.msg, 'success');
        // 3秒后自动关闭模态框并登出
        setTimeout(() => {
          changePasswordModal.classList.add('hidden');
          logout();
        }, 3000);
      } else {
        showPasswordMessage(result.msg || '修改失败', 'error');
      }
    } catch (parseError) {
      showPasswordMessage('服务器返回格式错误，请联系管理员', 'error');
    }
  } catch (error) {
    showPasswordMessage('网络错误，请稍后重试', 'error');
  }
});

// 显示密码修改消息
function showPasswordMessage(message, type) {
  passwordMessage.textContent = message;
  passwordMessage.classList.remove('hidden');

  // 设置消息样式
  passwordMessage.className = 'mt-4 text-center text-sm';
  if (type === 'success') {
    passwordMessage.classList.add('text-green-600');
  } else if (type === 'error') {
    passwordMessage.classList.add('text-red-600');
  }
}
