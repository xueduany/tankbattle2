// 本地 PeerJS 信令服务器（字节内网专用）
// 运行方式：node local-signaling-server.js
// 然后修改前端代码 host 为 'localhost'，port 为 9000

const { ExpressPeerServer } = require('peer');
const express = require('express');
const http = require('http');

const app = express();
const server = http.createServer(app);

const peerServer = ExpressPeerServer(server, {
  debug: true,
  path: '/myapp',
  allow_discovery: true,
});

app.use('/peerjs', peerServer);

const PORT = 9000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 本地信令服务器已启动！`);
  console.log(`📡 监听地址: http://0.0.0.0:${PORT}/peerjs/myapp`);
  console.log(`💡 使用方法：修改前端代码中的 host 为 'localhost' 或你的内网 IP，port 为 ${PORT}`);
});
