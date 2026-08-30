// ==========================
// 电量对接（浏览器端，ES5 写法）
// 用法：在设备端页面先引入 socket.io 客户端，再引入本文件
//   <script src="https://cdn.socket.io/4.8.1/socket.io.min.js"></script>
//   <script src="battery-client.js"></script>
// ==========================

// —— 按设备实际情况修改这四项 ——
var SERVER_URL = 'http://127.0.0.1:7011'; // 服务器地址
var DEVICE_ID = 'SN-0001';                // 设备唯一 ID
var MASTER = '张三';                       // 设备使用人
var VERSION = '1.0.3';                     // 客户端版本号

var socket = io(SERVER_URL, { reconnection: true });
var batteryReady = false;

// 连接后认证
socket.on('connect', function () {
  socket.emit('Mlzs', JSON.stringify([DEVICE_ID, MASTER, VERSION]));
});

// 认证成功后开始上报电量
socket.on('register_success', function () {
  console.log('认证成功，开始上报电量');
  startBatteryReport();
});

socket.on('register_fail', function (e) {
  console.error('认证失败:', e && e.reason);
});

// 读取并上报一次电量
function report(battery) {
  if (!socket.connected) return;
  socket.emit('battery', {
    battery: Math.round(battery.level * 100), // 0-100
    charging: battery.charging                // true/false
  });
}

// 开始电量上报：变化时上报 + 每 60 秒兜底上报一次
function startBatteryReport() {
  if (batteryReady) return;
  batteryReady = true;

  if (!navigator.getBattery) {
    console.warn('当前环境不支持 Battery API，无法读取真实电量');
    return;
  }

  navigator.getBattery().then(function (battery) {
    report(battery); // 立即上报一次

    battery.addEventListener('levelchange', function () {
      report(battery);
    });
    battery.addEventListener('chargingchange', function () {
      report(battery);
    });

    setInterval(function () {
      report(battery);
    }, 60 * 1000);
  });
}
