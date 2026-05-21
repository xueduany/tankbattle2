# Cyclic 部署详细指南

## 📋 目录

- [Cyclic 简介](#cyclic-简介)
- [前置准备](#前置准备)
- [部署步骤](#部署步骤)
- [环境变量配置](#环境变量配置)
- [验证部署](#验证部署)
- [常见问题](#常见问题)
- [故障排查](#故障排查)

---

## 🎯 Cyclic 简介

Cyclic 是一个优秀的免费 Node.js 托管平台，特点：
- ✅ **完全免费**，无需信用卡
- ✅ **不休眠**，24/7 运行
- ✅ 512MB RAM, 1 vCPU
- ✅ GitHub 自动部署
- ✅ 自动 HTTPS
- ✅ 无限请求

---

## 📦 前置准备

### 1. 确保项目配置正确

你的 `package.json` 已经有正确的配置：

```json
{
  "scripts": {
    "server": "node server.js"
  }
}
```

### 2. 检查 server.js

确保 `server.js` 使用正确的端口配置：

```javascript
const PORT = process.env.PORT || 3000;
```

✅ 你的配置已经是正确的！

---

## 🚀 部署步骤

### 步骤 1: 准备 GitHub 仓库

1. 将代码推送到 GitHub
2. 确保仓库是 Public（或 Private，Cyclic 都支持）
3. 确保以下文件存在：
   - `package.json`
   - `server.js`
   - `package-lock.json` 或 `yarn.lock`

### 步骤 2: 注册 Cyclic 账户

1. 访问 [https://www.cyclic.sh](https://www.cyclic.sh)
2. 点击 **Sign Up**
3. 使用 GitHub 账户登录（推荐）

### 步骤 3: 创建新应用

1. 登录后，点击 **Deploy New App**
2. 选择 **Link Your Own**
3. 选择你的 GitHub 仓库
4. 授权 Cyclic 访问你的仓库

### 步骤 4: 配置部署

在配置页面填写：

| 配置项 | 值 |
|--------|-----|
| **Branch** | `main`（或你的主分支） |
| **Runtime** | Node |
| **Build Command** | `npm install` |
| **Start Command** | `npm run server` |

### 步骤 5: 配置环境变量（可选）

如果需要自定义配置，可以添加环境变量（见下方详细说明）

### 步骤 6: 部署！

点击 **Deploy** 按钮，等待部署完成！

🎉 部署成功后，你会获得一个 URL，类似：
`https://your-app-name.cyclic.app`

---

## 🔧 环境变量配置

### 在 Cyclic 上配置环境变量

1. 进入你的应用管理页面
2. 点击 **Variables** 或 **Environment** 标签
3. 添加以下变量（根据需要）

### 可用的环境变量

#### 1. `PORT`（自动设置，无需手动配置）
Cyclic 会自动设置 `PORT` 环境变量，你的 `server.js` 已经正确使用了：
```javascript
const PORT = process.env.PORT || 3000;
```

#### 2. `NODE_ENV`（推荐设置）
```
NODE_ENV=production
```

#### 3. 自定义配置（可选）

如果你想添加自定义配置，可以在 Cyclic 中设置：

```
# 示例：CORS 配置
CORS_ORIGIN=*

# 示例：日志级别
LOG_LEVEL=info
```

### 更新 Home.tsx 支持环境变量

（可选）如果需要，你可以更新 `src/pages/Home.tsx` 让它在构建时也支持环境变量：

```typescript
// 在 Home.tsx 顶部
const SERVER_URL = import.meta.env.VITE_SOCKET_SERVER_URL || "http://localhost:3000";
```

✅ 你的代码已经支持了！

---

## ✅ 验证部署

### 1. 测试 Socket.IO 服务器

部署完成后，访问你的 Cyclic URL：
`https://your-app-name.cyclic.app`

你应该能看到：
- 如果访问根路径，可能会看到 "Cannot GET /"（这是正常的，因为我们没有配置根路由）
- 但 Socket.IO 服务器应该在运行

### 2. 测试连接

创建一个简单的测试脚本 `test-connection.js`：

```javascript
import { io } from "socket.io-client";

const SERVER_URL = "https://your-app-name.cyclic.app";

console.log("正在连接到:", SERVER_URL);

const socket = io(SERVER_URL);

socket.on("connect", () => {
  console.log("✅ 连接成功！Socket ID:", socket.id);
  socket.disconnect();
});

socket.on("connect_error", (error) => {
  console.error("❌ 连接失败:", error.message);
});
```

运行测试：
```bash
node test-connection.js
```

---

## 🔄 GitHub 自动部署

### 工作原理

一旦你在 Cyclic 上链接了 GitHub 仓库：
- 每次你 `git push` 到 `main` 分支
- Cyclic 会自动检测到变化
- 自动重新构建和部署

### 配置自动部署

1. 在 Cyclic 应用设置中
2. 确保 **Auto Deploy** 已开启（默认是开启的）
3. 选择要触发部署的分支（通常是 `main`）

### 查看部署日志

1. 在 Cyclic 应用页面
2. 点击 **Logs** 标签
3. 可以看到实时的构建和运行日志

---

## 📊 Cyclic 控制面板功能

### 1. 日志查看
- **Build Logs**: 查看构建过程
- **Runtime Logs**: 查看应用运行日志
- **Real-time Logs**: 实时日志流

### 2. 性能监控
- 查看内存使用情况
- 查看 CPU 使用情况
- 请求统计

### 3. 应用管理
- 手动重启应用
- 查看部署历史
- 回滚到之前版本

---

## ❓ 常见问题

### Q: 部署后前端连接不上 Socket.IO 服务器？

A: 确保你在 Vercel（或其他前端托管）中设置了正确的环境变量：
```
VITE_SOCKET_SERVER_URL=https://your-app-name.cyclic.app
```

### Q: Cyclic 应用会休眠吗？

A: **不会！** Cyclic 的免费计划不会让应用休眠，它会 24/7 运行。

### Q: 免费版有限制吗？

A: 免费版提供：
- 512MB RAM
- 1 vCPU
- 无限请求
- 无限带宽（合理使用范围内）

### Q: 可以同时部署多个应用吗？

A: 是的，Cyclic 允许免费部署多个应用！

### Q: 如何更新部署？

A: 只需要：
```bash
git add .
git commit -m "更新"
git push
```
Cyclic 会自动重新部署！

---

## 🔍 故障排查

### 问题 1: 部署失败

**检查清单：**
1. 查看 Cyclic 的 Build Logs
2. 确保 `package.json` 有 `server` 脚本
3. 确保 `server.js` 存在且没有语法错误

**常见原因：**
- 缺少依赖：确保 `package.json` 包含所有需要的依赖
- Node 版本问题：Cyclic 使用较新版本的 Node.js

### 问题 2: 应用启动但无法访问

**检查：**
1. 确保 `server.js` 监听在 `0.0.0.0`（默认就是）
2. 确保使用 `process.env.PORT`
3. 查看 Runtime Logs 是否有错误

### 问题 3: Socket.IO 连接超时

**可能原因：**
1. CORS 问题：确保你的 `server.js` 有正确的 CORS 配置
2. 防火墙：Cyclic 不会阻止 Socket.IO 连接
3. 客户端 URL 错误：检查前端使用的服务器 URL

**你的 CORS 配置已经是正确的：**
```javascript
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});
```

---

## 📝 完整部署检查清单

部署前确认：

- [ ] 代码已推送到 GitHub
- [ ] `package.json` 有 `server` 脚本
- [ ] `server.js` 使用 `process.env.PORT`
- [ ] CORS 配置允许所有来源（`*`）
- [ ] 测试本地运行正常
- [ ] 准备好 Cyclic 账户
- [ ] 准备好 Vercel 账户（用于前端）

部署后确认：

- [ ] Cyclic 显示部署成功
- [ ] 访问 Cyclic URL 没有错误
- [ ] Socket.IO 连接测试成功
- [ ] 前端已部署到 Vercel
- [ ] Vercel 环境变量设置正确
- [ ] 完整游戏测试通过

---

## 🎮 完整的生产部署流程

### 第一阶段：部署 Socket.IO 服务器到 Cyclic

1. 按照上面的步骤部署到 Cyclic
2. 获得服务器 URL：`https://your-app-name.cyclic.app`
3. 测试 Socket.IO 连接

### 第二阶段：部署前端到 Vercel

1. 在 Vercel 中导入项目
2. 设置环境变量：
   ```
   VITE_SOCKET_SERVER_URL=https://your-app-name.cyclic.app
   ```
3. 部署前端

### 第三阶段：测试完整流程

1. 访问 Vercel 前端 URL
2. 创建房间
3. 在另一个浏览器/设备加入房间
4. 测试多人游戏！

---

## 🆘 需要帮助？

如果遇到问题：
1. 查看 Cyclic 文档：https://docs.cyclic.sh
2. 查看本文的故障排查部分
3. 检查应用日志
4. 确认本地运行正常后再部署

---

## ✨ 提示和技巧

### 1. 使用自定义域名（可选）

Cyclic 支持自定义域名：
1. 在应用设置中点击 **Custom Domains**
2. 添加你的域名
3. 按照说明配置 DNS

### 2. 监控应用使用情况

定期检查 Cyclic 控制面板：
- 查看内存使用
- 查看响应时间
- 优化性能

### 3. 设置部署通知

Cyclic 可以在部署成功或失败时发送通知：
- 邮件通知
- Slack 通知
- Webhook 通知

### 4. 使用环境变量管理敏感信息

永远不要将敏感信息提交到 GitHub，使用 Cyclic 的环境变量功能！

---

祝部署顺利！🎮🚀
