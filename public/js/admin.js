// 管理员控制台页面逻辑（admin.html）
// 注意：本文件以传统脚本方式加载（非 type="module"），
// 因为 admin.html 及动态生成的卡片里的 onclick 内联处理器依赖
// logout / openTaskModal / removeDevice / editUser / deleteUser 等全局函数。

let currentUser = null;
let activeDevice = null;
let deviceTimer = null;
let logTimer = null;
let allMasters = [];
// 最近一次加载的用户列表，供用户列表的编辑/删除事件委托按 id 取回完整对象
let currentUsers = [];

// 页面加载验证登录
window.onload = () => {
  const userStr = sessionStorage.getItem('user');
  if (!userStr) {
    window.location.href = 'login.html';
    return;
  }

  try {
    currentUser = JSON.parse(userStr);

    // 验证是否为管理员
    if (currentUser.role !== 'admin') {
      alert('您没有管理员权限，正在跳转到普通用户页面');
      window.location.href = 'index.html';
      return;
    }

    // 验证登录有效性
    fetch('auth?action=check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
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
  document.getElementById('username').textContent = currentUser.username;

  // 更新系统时间
  updateSystemTime();
  setInterval(updateSystemTime, 1000);

  // 加载统计数据
  loadStatistics();

  // 加载设备列表
  loadDevices();
  deviceTimer = setInterval(loadDevices, 5000);

  // 加载使用人列表
  loadMasters();

  // 绑定事件
  document.getElementById('refreshAllBtn').addEventListener('click', refreshAll);
  document.getElementById('viewAllDevicesBtn').addEventListener('click', viewAllDevices);
  document.getElementById('searchBtn').addEventListener('click', searchDevices);
  document.getElementById('deviceSearch').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') searchDevices();
  });

  // 用户搜索事件
  document.getElementById('userSearch')?.addEventListener('input', function(e) {
    // 延迟搜索，避免频繁请求
    clearTimeout(window.searchTimeout);
    window.searchTimeout = setTimeout(() => {
      loadUsers();
    }, 300);
  });

  // 添加用户按钮事件
  document.getElementById('addUserBtn')?.addEventListener('click', function() {
    // 创建添加用户模态框
    const addModal = document.createElement('div');
    addModal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
    addModal.innerHTML = `
      <div class="bg-white rounded-lg shadow-xl w-full max-w-md p-6">
        <div class="flex justify-between items-center mb-4">
          <h3 class="text-lg font-bold text-gray-800">添加用户</h3>
          <button class="close-btn text-gray-500 hover:text-gray-700 text-xl">&times;</button>
        </div>
        <form class="add-user-form space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-700">用户名</label>
            <input type="text" name="username" class="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md" required>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700">密码</label>
            <input type="password" name="password" class="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md" required>
            <p class="mt-1 text-xs text-gray-500">密码长度至少6位</p>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700">真实姓名</label>
            <input type="text" name="realname" class="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md" required>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700">角色</label>
            <select name="role" class="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md">
              <option value="user" selected>普通用户</option>
            </select>
          </div>
          <div class="pt-2">
            <button type="submit" class="w-full py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary hover:bg-primary/90">添加用户</button>
          </div>
        </form>
        <div class="message mt-4 text-center text-sm hidden"></div>
      </div>
    `;

    // 添加到文档
    document.body.appendChild(addModal);

    // 关闭模态框函数
    function closeModal() {
      document.body.removeChild(addModal);
    }

    // 绑定关闭事件
    addModal.querySelector('.close-btn').addEventListener('click', closeModal);

    // 点击模态框外部关闭
    addModal.addEventListener('click', (e) => {
      if (e.target === addModal) closeModal();
    });

    // 表单提交处理
    addModal.querySelector('.add-user-form').addEventListener('submit', (e) => {
      e.preventDefault();

      // messageEl 必须在任何 showAddUserMessage 调用之前初始化：
      // 函数声明会提升，但 const 不会，提前调用会命中暂时性死区
      const messageEl = addModal.querySelector('.message');

      function showAddUserMessage(message, type) {
        messageEl.textContent = message;
        messageEl.className = 'mt-4 text-center text-sm';
        messageEl.classList.add(type === 'error' ? 'text-red-600' : 'text-green-600');
        messageEl.classList.remove('hidden');
      }

      const formData = new FormData(e.target);
      const formDataObj = {};
      formData.forEach((value, key) => {
        formDataObj[key] = value;
      });

      // 验证密码长度
      if (formDataObj.password.length < 6) {
        showAddUserMessage('密码长度至少6位', 'error');
        return;
      }

      // 发送添加请求
      fetch('user_management.php?action=add', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams(formDataObj)
      })
      .then(res => res.json())
      .then(data => {
        showAddUserMessage(data.msg || '操作成功', data.success ? 'success' : 'error');

        if (data.success) {
          // 3秒后关闭并刷新列表
          setTimeout(() => {
            closeModal();
            loadUsers();
          }, 1500);
        }
      })
      .catch(err => {
        console.error('添加用户错误:', err);
        showAddUserMessage('添加失败，请稍后重试', 'error');
      });
    });
  });
}

// 加载统计数据
function loadStatistics() {
  // console.log('开始加载统计数据...');
  // 这里可以通过一个专门的API获取统计数据
  // 暂时使用设备列表数据进行统计
  // 添加时间戳防止缓存
  const timestamp = new Date().getTime();
  fetch(`device_list.php?_=${timestamp}`, {
    cache: 'no-store',
    headers: {
      'Accept': 'application/json',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'Pragma': 'no-cache'
    }
  })
    .then(res => {
      // console.log('请求状态:', res.status);
      if (!res.ok) {
        throw new Error('HTTP错误状态: ' + res.status);
      }
      // 检查响应是否为JSON
      const contentType = res.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        // 如果不是JSON，尝试查看返回内容
        return res.text().then(text => {
          console.error('非JSON响应:', text);
          throw new Error('服务器返回非JSON数据');
        });
      }
      return res.json();
    })
    .then(data => {
      // console.log('获取到统计数据:', data);
      if (data.devices) {
        // 更新在线设备数（只统计status为online的设备）
        const onlineDevices = data.devices.filter(d => d.status === 'online');
        document.getElementById('totalOnline').textContent = onlineDevices.length;

        // 添加显示总设备数
        document.getElementById('totalDevices').textContent = data.devices.length;

        // 计算使用人数
        const masters = [...new Set(data.devices.map(d => d.master))];
        document.getElementById('totalMasters').textContent = masters.length;
      }

      // 模拟用户数和活跃会话数
      document.getElementById('totalUsers').textContent = '--';
      document.getElementById('activeSessions').textContent = '--';
    })
    .catch(err => {
      console.error('加载统计数据失败:', err);
    });
}

// 加载使用人列表
function loadMasters() {
  // console.log('开始加载使用人列表...');
  // 添加时间戳防止缓存
  const timestamp = new Date().getTime();
  fetch(`device_list.php?_=${timestamp}`, {
    cache: 'no-store',
    headers: {
      'Accept': 'application/json',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'Pragma': 'no-cache'
    }
  })
    .then(res => {
      // console.log('请求状态:', res.status);
      if (!res.ok) {
        throw new Error('HTTP错误状态: ' + res.status);
      }
      // 检查响应是否为JSON
      const contentType = res.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        // 如果不是JSON，尝试查看返回内容
        return res.text().then(text => {
          console.error('非JSON响应:', text);
          throw new Error('服务器返回非JSON数据');
        });
      }
      return res.json();
    })
    .then(data => {
      // console.log('获取到使用人数据:', data);
      if (data.devices) {
        // 获取所有唯一的使用人
        allMasters = [...new Set(data.devices.map(d => d.master))];

        // 填充下拉列表
        const select = document.getElementById('masterFilter');
        select.innerHTML = '<option value="">所有使用人</option>';

        allMasters.forEach(master => {
          const option = document.createElement('option');
          option.value = master;
          option.textContent = master;
          select.appendChild(option);
        });
      }
    })
    .catch(err => {
      console.error('加载使用人列表失败:', err);
    });
}

// 加载设备列表
function loadDevices(masterFilter = '', deviceSearch = '') {
  let url = 'device_list.php';

  // 构建查询参数
  const params = [];
  if (masterFilter) {
    params.push(`master=${encodeURIComponent(masterFilter)}`);
  }

  if (params.length > 0) {
    url += '?' + params.join('&');
  }

  // 添加时间戳防止缓存
  const timestamp = new Date().getTime();
  if (params.length > 0) {
    url += '&';
  } else {
    url += '?';
  }
  url += `_=${timestamp}`;

  fetch(url, {
    cache: 'no-store',
    headers: {
      'Accept': 'application/json',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'Pragma': 'no-cache'
    }
  })
    .then(res => res.json())
    .then(data => {
      const container = document.getElementById('deviceList');
      container.innerHTML = '';

      if (data.error) {
        container.innerHTML = `<div class="col-span-full p-4 text-center text-red-500">${data.error}</div>`;
        return;
      }

      let devices = data.devices || [];

      // 如果有设备ID搜索，进行过滤
      if (deviceSearch) {
        devices = devices.filter(device =>
          device.device_id.toLowerCase().includes(deviceSearch.toLowerCase())
        );
      }

      if (devices.length === 0) {
        container.innerHTML = `
          <div class="col-span-full p-6 text-center text-gray-500">
            <i class="fa fa-wifi text-gray-300 text-xl mb-2"></i>
            <p>暂无匹配的设备</p>
          </div>
        `;
        return;
      }

      // 生成设备卡片
      devices.forEach(device => {
        const isActive = activeDevice && activeDevice.device_id === device.device_id;
        const card = document.createElement('div');
        card.className = `device-card ${isActive ? 'active' : 'border-gray-200 bg-white'}`;
        card.onclick = (e) => {
          // 如果点击的是移除按钮，不执行选择设备操作
          if (!e.target.closest('.remove-device-btn')) {
            selectDevice(device);
          }
        };

        card.innerHTML = `
          <div class="flex justify-between items-start mb-2">
            <div class="flex items-center">
              <span class="w-2.5 h-2.5 rounded-full ${device.status === 'online' ? 'bg-success pulse' : 'bg-gray-400'} mr-2"></span>
              <span class="font-medium text-sm">${device.device_id}</span>
            </div>
            <div class="flex items-center gap-1">
              <button class="text-xs text-primary hover:text-blue-700 p-1" title="定时任务" onclick="event.stopPropagation(); openTaskModal('${device.device_id}', '${device.master}')">
                <i class="fa fa-clock-o"></i>
              </button>
              <button class="text-xs text-gray-500 hover:text-primary p-1" title="客户端配置" onclick="event.stopPropagation(); openConfigModal('${device.device_id}', '${device.master}')">
                <i class="fa fa-cog"></i>
              </button>
              <button class="remove-device-btn text-xs text-red-500 hover:text-red-700 p-1 rounded hover:bg-red-50" onclick="removeDevice('${device.device_id}', '${device.master}')">
                <i class="fa fa-trash-o"></i>
              </button>
              <span class="text-xs ${device.status === 'online' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'} px-1.5 py-0.5 rounded">${device.status === 'online' ? '在线' : '离线'}</span>
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
  const masterFilter = document.getElementById('masterFilter').value;
  const deviceSearch = document.getElementById('deviceSearch').value;
  loadDevices(masterFilter, deviceSearch);
}

// 加载日志
function loadLogs(master) {
  // 添加时间戳防止缓存
  const timestamp = new Date().getTime();
  fetch(`log_list.php?master=${encodeURIComponent(master)}&_=${timestamp}`, {
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
      // 检查响应内容类型
      const contentType = res.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        // 如果不是JSON，先获取文本内容
        return res.text().then(text => {
          console.error('非JSON响应:', text);
          // 尝试将文本作为日志内容显示
          return { logs: [{ content: text }] };
        });
      }
      return res.json();
    })
    .then(data => {
      const logEl = document.getElementById('logContent');

      // 处理JSON响应
      if (data.error) {
        logEl.textContent = `错误: ${data.error}`;
      } else if (data.logs && Array.isArray(data.logs)) {
        if (data.logs.length === 0) {
          logEl.textContent = '该设备暂无日志记录';
        } else {
          // 将日志条目格式化为文本
          const logText = data.logs.map(log => {
            if (typeof log === 'string') return log;
            return log.content || JSON.stringify(log);
          }).join('\n');
          logEl.textContent = logText;
        }
      } else {
        // 兼容旧格式，将整个响应作为文本
        logEl.textContent = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
      }

      document.getElementById('logUpdateTime').textContent = `最后更新：${new Date().toLocaleTimeString()}`;
    })
    .catch(err => {
      document.getElementById('logContent').textContent = `加载日志失败：${err.message}`;
    });
}

// 搜索设备
function searchDevices() {
  const masterFilter = document.getElementById('masterFilter').value;
  const deviceSearch = document.getElementById('deviceSearch').value;
  loadDevices(masterFilter, deviceSearch);
}

// 查看所有设备
function viewAllDevices() {
  document.getElementById('masterFilter').value = '';
  document.getElementById('deviceSearch').value = '';
  loadDevices('', '');
}

// 刷新所有数据
function refreshAll() {
  loadStatistics();
  loadMasters();
  searchDevices();
}

// 退出登录
function logout() {
  if (confirm('确定要退出登录吗？')) {
    sessionStorage.removeItem('user');
    window.location.href = 'login.html';
  }
}

// 移除设备
function removeDevice(deviceId, master) {
  if (confirm(`确定要移除设备 ${deviceId} 吗？此操作不可撤销。`)) {
    // 使用真实的API调用移除设备
    fetch('remove_device.php', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: `device_id=${encodeURIComponent(deviceId)}&master=${encodeURIComponent(master)}`
    })
    .then(res => {
      if (!res.ok) {
        throw new Error(`HTTP错误状态: ${res.status}`);
      }
      return res.json();
    })
    .then(data => {
      console.log('移除设备响应:', data);
      if (data.success) {
        alert(`设备 ${deviceId} 已成功移除！\n影响行数: ${data.affected_rows || 1}`);
        // 强制刷新设备列表
        setTimeout(() => {
          refreshAll();
        }, 500); // 添加短暂延迟确保数据已更新
      } else {
        alert(`移除失败: ${data.msg || '未知错误'}`);
      }
    })
    .catch(err => {
      console.error('移除设备错误:', err);
      alert(`移除设备时发生错误: ${err.message}\n请检查网络连接或联系管理员`);
    });
  }
}

// 用户管理功能
// 创建用户管理模态框
const userManagementModal = document.createElement('div');
userManagementModal.id = 'userManagementModal';
userManagementModal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 hidden';
userManagementModal.innerHTML = `
  <div class="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[80vh] flex flex-col">
    <div class="flex justify-between items-center p-6 border-b">
      <h3 class="text-lg font-bold text-gray-800">用户管理</h3>
      <button id="closeUserManagementModalBtn" class="text-gray-500 hover:text-gray-700 text-xl">&times;</button>
    </div>

    <div class="flex-1 overflow-y-auto p-6">
      <!-- 用户管理工具栏 -->
      <div class="mb-6 flex flex-wrap justify-between items-center gap-4">
        <h4 class="text-md font-medium">所有用户</h4>
        <button id="addUserBtn" class="px-4 py-2 bg-primary text-white rounded-md hover:bg-primary/90 transition-colors flex items-center">
          <i class="fa fa-plus mr-2"></i>添加用户
        </button>
      </div>

      <!-- 用户搜索 -->
      <div class="mb-6">
        <div class="relative">
          <span class="absolute inset-y-0 left-0 flex items-center pl-3 text-gray-400">
            <i class="fa fa-search"></i>
          </span>
          <input type="text" id="userSearch"
                 class="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-primary/30 focus:border-primary"
                 placeholder="搜索用户名或邮箱">
        </div>
      </div>

      <!-- 用户列表 -->
      <div class="overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200">
          <thead class="bg-gray-50">
            <tr>
              <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">用户名</th>
              <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">邮箱</th>
              <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">角色</th>
              <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">状态</th>
              <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">创建时间</th>
              <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>
            </tr>
          </thead>
          <tbody id="userList" class="bg-white divide-y divide-gray-200">
            <!-- 用户列表将通过JS动态生成 -->
            <tr>
              <td colspan="6" class="px-6 py-10 text-center text-gray-500">
                <i class="fa fa-spinner fa-spin mr-2"></i>加载用户中...
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="p-4 border-t flex justify-end">
      <button id="closeUserManagementModalBtn2" class="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50">
        关闭
      </button>
    </div>
  </div>
`;
document.body.appendChild(userManagementModal);

// 绑定用户管理卡片点击事件
document.getElementById('userManagementCard').addEventListener('click', () => {
  userManagementModal.classList.remove('hidden');
  // 加载用户列表
  loadUsers();
});

// 关闭用户管理模态框
document.getElementById('closeUserManagementModalBtn').addEventListener('click', () => {
  userManagementModal.classList.add('hidden');
});
document.getElementById('closeUserManagementModalBtn2').addEventListener('click', () => {
  userManagementModal.classList.add('hidden');
});

// 点击模态框外部关闭
userManagementModal.addEventListener('click', (e) => {
  if (e.target === userManagementModal) {
    userManagementModal.classList.add('hidden');
  }
});

// 用户列表的编辑/删除按钮：事件委托到 tbody（tbody 元素本身不会被替换，只绑定一次）
// 这样用户数据无需序列化进 HTML 属性，用户名里的引号、尖括号等字符也不会破坏标记
document.getElementById('userList').addEventListener('click', (e) => {
  const editBtn = e.target.closest('[data-edit-user]');
  const delBtn = e.target.closest('[data-del-user]');
  if (editBtn) {
    const user = currentUsers.find(u => String(u.id) === editBtn.getAttribute('data-edit-user'));
    if (user) editUser(user);
  } else if (delBtn) {
    const user = currentUsers.find(u => String(u.id) === delBtn.getAttribute('data-del-user'));
    if (user) deleteUser(user.id, user.username);
  }
});

// 加载用户列表
function loadUsers() {
  const userList = document.getElementById('userList');
  userList.innerHTML = `<tr><td colspan="6" class="px-6 py-10 text-center text-gray-500"><i class="fa fa-spinner fa-spin mr-2"></i>加载用户中...</td></tr>`;

  // 获取搜索关键词
  const searchInput = document.getElementById('userSearch');
  const searchKeyword = searchInput ? searchInput.value.trim() : '';

  // 使用真实的API调用获取用户列表
  fetch(`user_management.php?action=list&search=${encodeURIComponent(searchKeyword)}`, {
    method: 'GET',
    headers: {
      'Accept': 'application/json'
    }
  })
  .then(res => res.json())
  .then(data => {
    userList.innerHTML = '';

    if (data.success && data.users && Array.isArray(data.users)) {
      // 缓存本次结果，编辑/删除按钮据此按 id 取回完整用户对象
      currentUsers = data.users;

      if (data.users.length === 0) {
        userList.innerHTML = `<tr><td colspan="6" class="px-6 py-10 text-center text-gray-500">暂无用户</td></tr>`;
        return;
      }

      data.users.forEach(user => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${user.username}</td>
          <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${user.email || user.realname}</td>
          <td class="px-6 py-4 whitespace-nowrap">
            <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${user.role === 'admin' ? 'bg-purple-100 text-purple-800' : 'bg-blue-100 text-blue-800'}">
              ${user.role === 'admin' ? '管理员' : '普通用户'}
            </span>
          </td>
          <td class="px-6 py-4 whitespace-nowrap">
            <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${user.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}">
              ${user.status === 'active' ? '活跃' : '禁用'}
            </span>
          </td>
          <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${formatTime(user.created_at)}</td>
          <td class="px-6 py-4 whitespace-nowrap text-sm font-medium">
            ${user.role === 'admin' ?
              '<span class="text-gray-400 cursor-not-allowed" title="不能编辑管理员"><i class="fa fa-pencil mr-1"></i>编辑</span>' :
              `<button type="button" class="text-primary hover:text-primary/80 mr-3" data-edit-user="${user.id}"><i class="fa fa-pencil mr-1"></i>编辑</button>`
            }
            ${user.role === 'admin' ?
              '<span class="text-gray-400 cursor-not-allowed" title="不能删除管理员"><i class="fa fa-trash-o mr-1"></i>删除</span>' :
              `<button type="button" class="text-red-500 hover:text-red-700" data-del-user="${user.id}"><i class="fa fa-trash-o mr-1"></i>删除</button>`
            }
          </td>
        `;
        userList.appendChild(tr);
      });
    } else {
      userList.innerHTML = `<tr><td colspan="6" class="px-6 py-10 text-center text-red-500">加载用户失败: ${data.msg || '未知错误'}</td></tr>`;
    }
  })
  .catch(err => {
    console.error('加载用户列表错误:', err);
    userList.innerHTML = `<tr><td colspan="6" class="px-6 py-10 text-center text-red-500">加载用户失败，请稍后重试</td></tr>`;
  });
}

// 编辑用户
// user 为 loadUsers 缓存的用户对象（由 #userList 的事件委托传入）
function editUser(user) {
  // 创建编辑用户模态框
  const editModal = document.createElement('div');
  editModal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
  editModal.innerHTML = `
    <div class="bg-white rounded-lg shadow-xl w-full max-w-md p-6">
      <div class="flex justify-between items-center mb-4">
        <h3 class="text-lg font-bold text-gray-800">编辑用户</h3>
        <button class="close-btn text-gray-500 hover:text-gray-700 text-xl">&times;</button>
      </div>
      <form class="edit-user-form space-y-4">
        <input type="hidden" name="user_id">
        <div>
          <label class="block text-sm font-medium text-gray-700">用户名</label>
          <input type="text" name="username" class="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md" disabled>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700">真实姓名</label>
          <input type="text" name="realname" class="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md" required>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700">角色</label>
          <select name="role" class="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md">
            <option value="user" ${user.role === 'user' ? 'selected' : ''}>普通用户</option>
          </select>
        </div>
        <div class="pt-2">
          <button type="submit" class="w-full py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary hover:bg-primary/90">保存修改</button>
        </div>
      </form>
      <div class="message mt-4 text-center text-sm hidden"></div>
    </div>
  `;

  // 添加到文档
  document.body.appendChild(editModal);

  // 表单初值用属性赋值，不拼进 HTML，避免用户名/姓名中的引号等字符破坏标记
  editModal.querySelector('[name="user_id"]').value = user.id;
  editModal.querySelector('[name="username"]').value = user.username;
  editModal.querySelector('[name="realname"]').value = user.email || user.realname || '';

  // 关闭模态框函数
  function closeModal() {
    document.body.removeChild(editModal);
  }

  // 绑定关闭事件
  editModal.querySelector('.close-btn').addEventListener('click', closeModal);

  // 点击模态框外部关闭
  editModal.addEventListener('click', (e) => {
    if (e.target === editModal) closeModal();
  });

  // 表单提交处理
  editModal.querySelector('.edit-user-form').addEventListener('submit', (e) => {
    e.preventDefault();

    const formData = new FormData(e.target);
    const formDataObj = {};
    formData.forEach((value, key) => {
      formDataObj[key] = value;
    });

    const messageEl = editModal.querySelector('.message');

    // 发送编辑请求
    fetch('user_management.php?action=edit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams(formDataObj)
    })
    .then(res => res.json())
    .then(data => {
      messageEl.textContent = data.msg || '操作成功';
      messageEl.className = 'mt-4 text-center text-sm';
      messageEl.classList.add(data.success ? 'text-green-600' : 'text-red-600');
      messageEl.classList.remove('hidden');

      if (data.success) {
        // 3秒后关闭并刷新列表
        setTimeout(() => {
          closeModal();
          loadUsers();
        }, 1500);
      }
    })
    .catch(err => {
      console.error('编辑用户错误:', err);
      messageEl.textContent = '编辑失败，请稍后重试';
      messageEl.className = 'mt-4 text-center text-sm text-red-600';
      messageEl.classList.remove('hidden');
    });
  });
}

// 删除用户
function deleteUser(userId, username) {
  if (confirm(`确定要删除用户 ${username} 吗？此操作不可撤销。`)) {
    // 发送删除请求
    fetch('user_management.php?action=delete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: `user_id=${userId}`
    })
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        alert(`用户 ${username} 已成功删除！`);
        loadUsers();
      } else {
        alert(`删除失败: ${data.msg || '未知错误'}`);
      }
    })
    .catch(err => {
      console.error('删除用户错误:', err);
      alert('删除用户时发生网络错误，请稍后重试');
    });
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

// ==== 客户端配置弹窗（按使用人）====
// 配置由客户端通过 socket.io 的 config 事件上报，后台只读
function openConfigModal(deviceId, master) {
  const modal = document.createElement('div');
  modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4';
  modal.innerHTML = `
    <div class="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
      <div class="flex justify-between items-center px-5 py-3 border-b">
        <h3 class="font-semibold text-gray-800"><i class="fa fa-cog mr-1 text-primary"></i>客户端配置</h3>
        <button class="close-btn text-gray-400 hover:text-gray-600"><i class="fa fa-times"></i></button>
      </div>
      <div class="p-5 overflow-y-auto">
        <p class="text-xs text-gray-400 mb-3">配置由客户端上报，此处只读。按使用人存储，同一使用人换设备会覆盖同一条记录。</p>
        <div class="cfg-box text-sm text-gray-500">加载中...</div>
      </div>
      <div class="px-5 py-3 border-t flex justify-end gap-2">
        <button class="cfg-refresh px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50"><i class="fa fa-refresh mr-1"></i>刷新</button>
        <button class="close-btn px-3 py-1.5 text-sm bg-primary text-white rounded hover:opacity-90">关闭</button>
      </div>
    </div>`;
  document.body.appendChild(modal);

  const close = () => document.body.removeChild(modal);
  modal.querySelectorAll('.close-btn').forEach(btn => btn.addEventListener('click', close));
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

  const box = modal.querySelector('.cfg-box');

  // secret 为真的字段默认打码（推送Key 是凭据）
  const FIELDS = [
    { key: 'master', label: '使用人' },
    { key: 'device_Id', label: '设备ID' },
    { key: 'server_Uid', label: '推送ID' },
    { key: 'server_key', label: '推送Key', secret: true },
    { key: 'corp_Id', label: '钉钉ID' },
    { key: 'updated_at', label: '最后上传', format: formatTime },
  ];

  // 值一律用 textContent 写入，避免配置内容里的特殊字符破坏标记
  function render(cfg) {
    box.innerHTML = '';
    const dl = document.createElement('dl');
    dl.className = 'divide-y divide-gray-100';

    for (const f of FIELDS) {
      const raw = cfg[f.key];
      const isEmpty = raw === null || raw === undefined || raw === '';
      const text = isEmpty ? '' : (f.format ? f.format(raw) : String(raw));

      const row = document.createElement('div');
      row.className = 'flex items-start gap-3 py-2';

      const dt = document.createElement('dt');
      dt.className = 'w-20 shrink-0 text-xs text-gray-500 pt-0.5';
      dt.textContent = f.label;

      const dd = document.createElement('dd');
      dd.className = 'flex-1 min-w-0 text-sm break-all font-mono';

      if (isEmpty) {
        dd.classList.add('text-gray-400');
        dd.textContent = '—';
      } else if (f.secret) {
        const mask = '•'.repeat(Math.min(24, text.length));
        const span = document.createElement('span');
        span.className = 'text-gray-800';
        span.textContent = mask;

        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'ml-2 text-xs text-primary hover:underline font-sans';
        toggle.textContent = '显示';

        let shown = false;
        toggle.addEventListener('click', () => {
          shown = !shown;
          span.textContent = shown ? text : mask;
          toggle.textContent = shown ? '隐藏' : '显示';
        });

        dd.appendChild(span);
        dd.appendChild(toggle);
      } else {
        dd.classList.add('text-gray-800');
        dd.textContent = text;
      }

      row.appendChild(dt);
      row.appendChild(dd);
      dl.appendChild(row);
    }

    box.appendChild(dl);
  }

  function loadConfig() {
    box.className = 'cfg-box text-sm text-gray-500';
    box.textContent = '加载中...';

    const ts = Date.now();
    fetch(`client_config.php?action=get&master=${encodeURIComponent(master)}&device_id=${encodeURIComponent(deviceId)}&_=${ts}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(data => {
        if (!data.success) {
          box.className = 'cfg-box text-sm text-red-500';
          box.textContent = '加载失败：' + (data.msg || '未知错误');
          return;
        }
        if (!data.config) {
          box.className = 'cfg-box text-sm text-gray-400';
          box.textContent = `使用人「${master}」尚未上报配置`;
          return;
        }
        box.className = 'cfg-box text-sm';
        render(data.config);
      })
      .catch(() => {
        box.className = 'cfg-box text-sm text-red-500';
        box.textContent = '加载配置失败，请稍后重试';
      });
  }

  modal.querySelector('.cfg-refresh').addEventListener('click', loadConfig);
  loadConfig();
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

// 修改密码功能
// 创建修改密码模态框
const changePasswordModal = document.createElement('div');
changePasswordModal.id = 'changePasswordModal';
changePasswordModal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 hidden';
changePasswordModal.innerHTML = `
  <div class="bg-white rounded-lg shadow-xl w-full max-w-md p-6">
    <div class="flex justify-between items-center mb-4">
      <h3 class="text-lg font-bold text-gray-800">修改密码</h3>
      <button id="closeChangePasswordModalBtn" class="text-gray-500 hover:text-gray-700">&times;</button>
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

// 绑定修改密码按钮事件
document.getElementById('changePasswordBtn').addEventListener('click', () => {
  if (currentUser) {
    document.getElementById('changeUsername').value = currentUser.username;
    changePasswordModal.classList.remove('hidden');
    // 重置表单和消息
    document.getElementById('changePasswordForm').reset();
    document.getElementById('passwordMessage').textContent = '';
    document.getElementById('passwordMessage').classList.add('hidden');
  }
});

// 关闭修改密码模态框
document.getElementById('closeChangePasswordModalBtn').addEventListener('click', () => {
  changePasswordModal.classList.add('hidden');
});

// 点击模态框外部关闭
changePasswordModal.addEventListener('click', (e) => {
  if (e.target === changePasswordModal) {
    changePasswordModal.classList.add('hidden');
  }
});

// 处理密码修改表单提交
document.getElementById('changePasswordForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const username = document.getElementById('changeUsername').value;
  const currentPwd = document.getElementById('currentPwd').value;
  const newPwd = document.getElementById('newPwd').value;
  const confirmPwd = document.getElementById('confirmPwd').value;

  // 验证两次输入的新密码是否一致
  if (newPwd !== confirmPwd) {
    showPasswordMessage('两次输入的新密码不一致', 'error');
    return;
  }

  try {
    // console.log('开始发送修改密码请求');
    // console.log('请求参数:', { username, currentPwd: '******', newPwd: '******' });

    const response = await fetch('auth?action=changePassword', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: `user=${encodeURIComponent(username)}&currentPwd=${encodeURIComponent(currentPwd)}&newPwd=${encodeURIComponent(newPwd)}`
    });

    // 直接解析JSON
    try {
      const result = await response.json();

      if (result.success) {
        showPasswordMessage(result.msg, 'success');
        // 3秒后自动关闭模态框并登出
        setTimeout(() => {
          changePasswordModal.classList.add('hidden');
          sessionStorage.removeItem('user');
          window.location.href = 'login.html';
        }, 3000);
      } else {
        showPasswordMessage(result.msg || '修改失败', 'error');
      }
    } catch (parseError) {
      showPasswordMessage('服务器返回格式错误，请联系管理员', 'error');
    }
  } catch (error) {
    console.error('修改密码错误:', error);
    showPasswordMessage('网络错误，请稍后重试', 'error');
  }
});

// 显示密码修改消息
function showPasswordMessage(message, type) {
  const passwordMessage = document.getElementById('passwordMessage');
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
