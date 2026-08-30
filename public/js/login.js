// 登录 / 注册页逻辑（login.html）
// 注意：本文件以传统脚本方式加载（非 type="module"），
// 因为 login.html 中的 onclick / javascript: 内联处理器依赖全局函数。

// 表单切换
function switchToRegister() {
  document.getElementById('loginForm').classList.add('hidden');
  document.getElementById('registerForm').classList.remove('hidden');
  clearMsg();
}

function switchToLogin() {
  document.getElementById('registerForm').classList.add('hidden');
  document.getElementById('loginForm').classList.remove('hidden');
  clearMsg();
}

// 消息提示
function showMsg(text, isError = false) {
  const el = document.getElementById('msg');
  el.textContent = text;
  el.classList.remove('hidden', 'bg-green-100', 'text-green-700', 'bg-red-100', 'text-red-700');
  if (isError) {
    el.classList.add('bg-red-100', 'text-red-700');
  } else {
    el.classList.add('bg-green-100', 'text-green-700');
  }
}

function clearMsg() {
  const el = document.getElementById('msg');
  el.classList.add('hidden');
  el.textContent = '';
}

// 登录处理
function handleLogin() {
  const user = document.getElementById('loginUser').value.trim();
  const pwd = document.getElementById('loginPwd').value.trim();
  const btn = document.getElementById('loginBtn');

  if (!user || !pwd) {
    return showMsg('请输入用户名和密码', true);
  }

  // 按钮加载状态
  btn.disabled = true;
  btn.innerHTML = '<i class="fa fa-spinner fa-spin mr-1"></i>登录中...';

  fetch('auth?action=login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `user=${encodeURIComponent(user)}&pwd=${encodeURIComponent(pwd)}`
  })
  .then(res => res.json().catch(() => {
    throw new Error('服务器响应格式错误');
  }))
  .then(data => {
    console.log('登录响应数据:', data);
    if (data.success && data.user) {
      // 确保用户对象包含role字段
      const userData = {
        ...data.user,
        role: data.user.role || 'user' // 默认普通用户角色
      };
      console.log('准备存储的用户数据:', userData);
      sessionStorage.setItem('user', JSON.stringify(userData));
      console.log('sessionStorage存储后的值:', sessionStorage.getItem('user'));

      // 根据用户角色跳转到不同页面
      if (userData.role === 'admin') {
        console.log('准备跳转到admin.html');
        window.location.href = 'admin.html';
      } else {
        console.log('准备跳转到index.html');
        window.location.href = 'index.html';
      }
    } else {
      showMsg(data.msg || '登录失败', true);
    }
  })
  .catch(err => {
    showMsg('登录失败：' + err.message, true);
  })
  .finally(() => {
    btn.disabled = false;
    btn.textContent = '登录';
  });
}

// 注册处理
function handleRegister() {
  const user = document.getElementById('regUser').value.trim();
  const pwd = document.getElementById('regPwd').value.trim();
  const name = document.getElementById('regName').value.trim();
  const btn = document.getElementById('regBtn');

  // 表单验证
  if (!user) return showMsg('请输入用户名', true);
  if (!pwd) return showMsg('请输入密码', true);
  if (pwd.length < 6) return showMsg('密码至少6位', true);
  if (!name) return showMsg('请输入真实姓名', true);

  // 按钮加载状态
  btn.disabled = true;
  btn.innerHTML = '<i class="fa fa-spinner fa-spin mr-1"></i>注册中...';

  fetch('auth?action=register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `user=${encodeURIComponent(user)}&pwd=${encodeURIComponent(pwd)}&name=${encodeURIComponent(name)}`
  })
  .then(res => res.json().catch(() => {
    throw new Error('服务器响应格式错误');
  }))
  .then(data => {
    if (data.success) {
      // 注册成功，默认角色为普通用户
      showMsg('注册成功，即将跳转到登录页');
      setTimeout(switchToLogin, 1500);
    } else {
      showMsg(data.msg || '注册失败', true);
    }
  })
  .catch(err => {
    showMsg('注册失败：' + err.message, true);
  })
  .finally(() => {
    btn.disabled = false;
    btn.textContent = '注册';
  });
}

// 绑定回车键
document.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    if (document.getElementById('loginForm').classList.contains('hidden')) {
      handleRegister();
    } else {
      handleLogin();
    }
  }
});

// 冗余事件绑定
document.querySelector('a[href="javascript:switchToRegister()"]').addEventListener('click', switchToRegister);
document.querySelector('a[href="javascript:switchToLogin()"]').addEventListener('click', switchToLogin);
