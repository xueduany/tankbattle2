#!/usr/bin/env node

/**
 * Cyclic Socket.IO 服务器连接测试脚本
 * 使用方法：node test-cyclic-connection.js <your-cyclic-url>
 */

import { io } from "socket.io-client";

// 获取命令行参数中的服务器 URL
const args = process.argv.slice(2);
let SERVER_URL = args[0];

if (!SERVER_URL) {
  console.log(`
⚠️  请提供 Cyclic 服务器 URL！

使用方法：
  node test-cyclic-connection.js https://your-app-name.cyclic.app

示例：
  node test-cyclic-connection.js https://tank-battle-server.cyclic.app
`);
  process.exit(1);
}

// 确保 URL 格式正确
if (!SERVER_URL.startsWith('http')) {
  SERVER_URL = 'https://' + SERVER_URL;
}

console.log(`
🚀 正在测试 Cyclic Socket.IO 服务器连接...

服务器地址: ${SERVER_URL}
`);

const socket = io(SERVER_URL, {
  timeout: 10000, // 10秒超时
});

let connected = false;

socket.on("connect", () => {
  connected = true;
  console.log(`
✅ 连接成功！
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Socket ID: ${socket.id}
服务器: ${SERVER_URL}
状态: 在线
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);

  console.log("正在测试创建房间...");
  socket.emit("createRoom");
});

socket.on("roomCreated", ({ roomCode, playerId }) => {
  console.log(`
✅ 房间创建成功！
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
房间码: ${roomCode}
玩家ID: ${playerId}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);

  console.log("\n🎉 Cyclic 服务器部署完全正常！可以开始使用了！\n");
  socket.disconnect();
  process.exit(0);
});

socket.on("connect_error", (error) => {
  console.error(`
❌ 连接失败！
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
错误信息: ${error.message}
服务器: ${SERVER_URL}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);

  console.log(`
💡 故障排查建议：

1. 检查服务器 URL 是否正确
2. 确认 Cyclic 应用已成功部署
3. 查看 Cyclic 应用日志是否有错误
4. 确认 server.js 正在运行
5. 检查 CORS 配置

详细指南请查看 cyclic.md 文件
`);
  process.exit(1);
});

socket.on("disconnect", () => {
  if (!connected) {
    console.log("⚠️  连接断开");
  }
});

// 超时处理
setTimeout(() => {
  if (!connected) {
    console.error(`
⏰ 连接超时！
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
服务器: ${SERVER_URL}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
    process.exit(1);
  }
}, 15000);
