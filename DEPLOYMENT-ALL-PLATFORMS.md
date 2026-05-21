# Socket.IO 服务器部署指南（多平台）

由于 Cyclic 可能有临时的 DNS 问题，这里为你准备了多个免费平台的部署指南！

---

## 🎯 平台对比

| 平台 | 免费额度 | GitHub同步 | 应用休眠 | WebSocket | 推荐度 |
|------|---------|-----------|---------|----------|--------|
| **Render** | 750小时/月, 512MB RAM | ✅ | 15分钟后 | ✅ | ⭐⭐⭐⭐⭐ |
| **Railway** | $5/月额度 | ✅ | 是 | ✅ | ⭐⭐⭐⭐ |
| **Replit** | 512MB RAM, 0.2CPU | ✅ | 是 | ✅ | ⭐⭐⭐⭐ |
| **Fly.io** | $5一次性额度 | ✅ | 是 | ✅ | ⭐⭐⭐ |
| **Glitch** | 512MB RAM | ✅ | 5分钟后 | ✅ | ⭐⭐⭐ |

---

## 🏆 方案一：Render（最推荐，最稳定）

### 为什么选 Render？
- 类似 Heroku 的简单体验
- 完美支持 Socket.IO
- 免费额度足够小项目
- 即使休眠，首次请求会快速唤醒

### 部署步骤

1. 访问 [https://render.com](https://render.com)
2. 使用 GitHub 账户注册/登录
3. 点击 **New +** → **Web Service**
4. 选择你的 GitHub 仓库
5. 配置如下：

| 配置项 | 值 |
|--------|-----|
| **Name** | tank-battle-server（自定义） |
| **Region** | 选择离你近的地区 |
| **Branch** | main（或你的主分支） |
| **Runtime** | Node |
| **Build Command** | `npm install` |
| **Start Command** | `npm run server` |
| **Instance Type** | Free |

6. 点击 **Create Web Service**
7. 等待部署完成！

### 获得你的服务器 URL
部署成功后，你会获得一个类似这样的 URL：
`https://tank-battle-server.onrender.com`

### 配置 Vercel 环境变量
在 Vercel 项目设置中添加：
```
VITE_SOCKET_SERVER_URL=https://tank-battle-server.onrender.com
```

---

## 💎 方案二：Railway（现代化体验）

### 为什么选 Railway？
- 现代化 UI，体验很好
- $5 免费额度足够用
- 支持数据库集成
- 实时日志查看

### 部署步骤

1. 访问 [https://railway.app](https://railway.app)
2. 使用 GitHub 账户注册/登录
3. 点击 **New Project** → **Deploy from GitHub repo**
4. 选择你的仓库
5. 配置部署：
   - **Start Command**：`npm run server`
6. 点击 **Deploy**
7. 等待部署完成，点击项目查看 URL

### 免费额度
- $5 月度信用额度
- 约 500 小时运行时间

---

## 🚀 方案三：Replit（最简单，即时运行）

### 为什么选 Replit？
- 浏览器内完整开发环境
- 即时部署，无需等待
- 可以实时编辑代码
- 支持直接从 GitHub 导入

### 部署步骤

1. 访问 [https://replit.com](https://replit.com)
2. 注册/登录账户
3. 点击 **Create** → **Import from GitHub**
4. 输入你的仓库 URL
5. 配置：
   - **Language**：Node.js
   - **Run command**：`npm run server`
6. 点击 **Import from GitHub**
7. 等待导入完成，点击 **Run**

### Replit 特别配置

创建一个 `.replit` 文件：
```toml
run = "npm run server"
entrypoint = "server.js"

[deployment]
run = "npm run server"
```

### 免费额度
- 512MB RAM
- 0.2 vCPU
- 需要偶尔手动唤醒

---

## ✈️ 方案四：Fly.io（边缘部署，低延迟）

### 为什么选 Fly.io？
- 全球边缘网络，低延迟
- Docker 容器化部署
- $5 一次性免费额度

### 部署步骤

1. 安装 Fly CLI：
   ```bash
   # macOS/Linux
   curl -L https://fly.io/install.sh | sh
   
   # Windows (PowerShell)
   powershell -Command "iwr https://fly.io/install.ps1 -useb | iex"
   ```

2. 注册并登录：
   ```bash
   fly auth signup
   # 或
   fly auth login
   ```

3. 在项目目录中初始化：
   ```bash
   fly launch
   ```

4. 按照提示配置：
   - 选择应用名称
   - 选择部署区域
   - 选择是否创建数据库（不需要，选 No）

5. 部署：
   ```bash
   fly deploy
   ```

6. 查看你的应用：
   ```bash
   fly open
   ```

---

## 🎓 方案五：Glitch（适合学习和原型）

### 为什么选 Glitch？
- 浏览器内实时编辑
- 即时部署
- 可以 Remix 其他项目
- 适合学习和快速原型

### 部署步骤

1. 访问 [https://glitch.com](https://glitch.com)
2. 注册/登录
3. 点击 **New Project** → **Import from GitHub**
4. 输入你的仓库 URL
5. Glitch 会自动导入并部署

### 注意事项
- 5 分钟无活动会休眠
- 手动访问可以唤醒
- 适合学习，不太适合生产

---

## 🔧 通用配置说明

### 1. 确保 server.js 配置正确

你的 [server.js](server.js) 已经是正确的：
```javascript
const PORT = process.env.PORT || 3000;

const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});
```

✅ 这对所有平台都适用！

### 2. package.json 脚本

确保有正确的启动脚本：
```json
{
  "scripts": {
    "server": "node server.js",
    "start": "node server.js"  // 有些平台需要这个
  }
}
```

✅ 你的配置已经包含了！

### 3. 环境变量配置

#### 在 Render 上：
1. 进入应用设置
2. 点击 **Environment** 标签
3. 添加变量（可选）：
   ```
   NODE_ENV=production
   ```

#### 在 Railway 上：
1. 进入项目
2. 点击 **Variables**
3. 添加需要的环境变量

#### 在 Replit 上：
1. 点击 **Secrets** 标签
2. 添加环境变量

---

## ✅ 部署验证步骤

### 步骤 1：测试服务器是否运行

部署后，访问你的服务器 URL：
- Render: `https://your-app.onrender.com`
- Railway: `https://your-app.up.railway.app`
- Replit: `https://your-app.repl.co`

即使看到 "Cannot GET /" 也是正常的，因为我们没配置根路由！

### 步骤 2：测试 Socket.IO 连接

创建并运行这个测试脚本：

```javascript
import { io } from "socket.io-client";

// 替换为你的服务器 URL
const SERVER_URL = "https://your-app.onrender.com";

console.log("连接到:", SERVER_URL);

const socket = io(SERVER_URL);

socket.on("connect", () => {
  console.log("✅ 连接成功！Socket ID:", socket.id);
  socket.emit("createRoom");
});

socket.on("roomCreated", ({ roomCode, playerId }) => {
  console.log("✅ 房间创建成功！");
  console.log("房间码:", roomCode);
  console.log("玩家ID:", playerId);
  socket.disconnect();
  console.log("\n🎉 服务器完全正常！");
});

socket.on("connect_error", (error) => {
  console.error("❌ 连接失败:", error.message);
});
```

### 步骤 3：在 Vercel 中配置环境变量

1. 进入 Vercel 项目设置
2. 点击 **Environment Variables**
3. 添加：
   ```
   VITE_SOCKET_SERVER_URL=https://your-app.onrender.com
   ```
4. 重新部署 Vercel 项目

---

## 🎯 我的推荐

### 对于这个坦克大战项目，我建议：

**首选：Render**
- 稳定可靠
- 简单易用
- 免费额度足够
- 即使休眠也会快速唤醒

**备选：Replit**
- 超简单，即时运行
- 可以直接在浏览器内修改代码
- 适合快速测试

---

## 📊 休眠策略对比

| 平台 | 休眠时间 | 唤醒速度 | 推荐度 |
|------|---------|---------|--------|
| Render | 15分钟 | ⚡ 快 | ⭐⭐⭐⭐⭐ |
| Railway | 是 | ⚡ 快 | ⭐⭐⭐⭐ |
| Replit | 是 | ⚡ 快 | ⭐⭐⭐⭐ |
| Fly.io | 是 | ⚡ 快 | ⭐⭐⭐ |
| Glitch | 5分钟 | ⚡ 快 | ⭐⭐⭐ |

**提示**：对于坦克大战，即使应用休眠，第一个玩家连接时会快速唤醒，体验影响不大！

---

## 🚀 开始部署吧！

1. 选择一个平台（推荐 Render）
2. 按照上面的步骤部署
3. 获得服务器 URL
4. 在 Vercel 中配置环境变量
5. 测试游戏！

有问题随时查看各平台的文档或者问我！🎮
