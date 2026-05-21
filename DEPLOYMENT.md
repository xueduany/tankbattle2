# 部署指南 / Deployment Guide

## 概述 / Overview

由于我们使用 Socket.IO 架构，需要分开部署前端和后端：

- **前端**：部署到 Vercel
- **后端 Socket.IO 服务器**：部署到其他支持 Node.js 的平台

---

## 1. 部署 Socket.IO 服务器 / Deploy Socket.IO Server

### 🎯 推荐平台对比 / Recommended Platforms Comparison

| 平台 | 免费额度 | GitHub 自动部署 | 应用休眠 | 推荐度 | 适合 |
|------|---------|----------------|---------|--------|------|
| **Render** | 750 小时/月, 512MB RAM | ✅ | 15 分钟后 | ⭐⭐⭐⭐⭐ | 简单、稳定 |
| **Railway** | $5 免费额度 | ✅ | 是 | ⭐⭐⭐⭐ | 原型开发 |
| **Cyclic** | 512MB RAM, 不限制 | ✅ | ❌ 不休眠 | ⭐⭐⭐⭐⭐ | 全天候运行 |
| **Fly.io** | $5 一次性信用 | ✅ | 是 | ⭐⭐⭐ | 边缘应用 |
| **Glitch** | 512MB RAM | ✅ | 5 分钟后 | ⭐⭐⭐ | 学习、原型 |

---

### 🏆 A. Render（最推荐，最简单）

**为什么选择 Render？**
- 类似 Heroku 的简单体验
- 完美支持 GitHub 自动部署
- 免费额度足够小项目使用

**部署步骤：**
1. 注册 [Render](https://render.com)
2. 点击 **New +** → **Web Service**
3. 连接你的 GitHub 仓库
4. 配置：
   - **Name**: `tank-battle-server`（自定义）
   - **Region**: 选择离你最近的
   - **Branch**: `main`（或你的主分支）
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm run server`
5. 点击 **Create Web Service**
6. 等待部署完成，获得 URL，如 `https://tank-battle-server.onrender.com`

**免费额度：**
- 750 小时/月（足够全天候运行 1 个应用）
- 512MB RAM
- 0.1 CPU
- 自动 HTTPS

**注意：** 应用 15 分钟无活动会休眠，但第一个请求会唤醒它。

---

### 🚀 B. Cyclic（不休眠，免费！）

**为什么选择 Cyclic？**
- **真正免费，不休眠**！
- GitHub 自动部署
- 512MB RAM, 1 vCPU

**部署步骤：**
1. 注册 [Cyclic](https://www.cyclic.sh)
2. 点击 **Deploy New App**
3. 选择 **Link Your Own**
4. 连接 GitHub 仓库
5. 配置：
   - **Branch**: `main`
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm run server`
6. 点击 **Deploy**

**免费额度：**
- 无限请求
- 512MB RAM, 1 vCPU
- 不限制运行时间，**不休眠**！
- 自动 HTTPS

---

### 💎 C. Railway

**为什么选择 Railway？**
- 现代化的用户界面
- $5 免费额度（约 500 小时）
- 实时日志和监控

**部署步骤：**
1. 注册 [Railway](https://railway.app)
2. 点击 **New Project** → **Deploy from GitHub repo**
3. 连接你的仓库
4. 配置：
   - **Start Command**: `npm run server`
5. 点击 **Deploy**

**免费额度：**
- $5 月度信用额度
- 可以添加数据库（PostgreSQL、MongoDB 等）
- GitHub 自动部署

---

### 🎓 D. Glitch（适合学习）

**为什么选择 Glitch？**
- 浏览器内代码编辑
- 实时协作
- 适合学习和快速原型

**部署步骤：**
1. 访问 [Glitch](https://glitch.com)
2. 点击 **New Project** → **Import from GitHub**
3. 输入你的仓库 URL
4. Glitch 会自动部署！

**免费额度：**
- 512MB RAM
- 5 分钟无活动休眠
- 可以手动唤醒

---

### ✈️ E. Fly.io

**为什么选择 Fly.io？**
- 全球边缘网络
- $5 一次性信用额度
- CLI 优先的体验

**部署步骤：**
1. 安装 Fly CLI: `curl -L https://fly.io/install.sh | sh`
2. 注册 [Fly.io](https://fly.io)
3. 在项目目录运行: `fly launch`
4. 按照提示配置
5. 运行: `fly deploy`

---

### 📊 平台选择指南

| 需求 | 推荐平台 |
|------|---------|
| 最简单、最稳定 | **Render** |
| 要 24/7 运行、不休眠 | **Cyclic** |
| 快速原型开发 | **Railway** 或 **Glitch** |
| 学习和实验 | **Glitch** |
| 全球边缘部署 | **Fly.io** |

---

## 2. 部署前端到 Vercel / Deploy Frontend to Vercel

### 步骤 1：配置环境变量 / Step 1: Configure Environment Variables

在 Vercel 项目设置中，添加环境变量：
```
VITE_SOCKET_SERVER_URL=https://your-socket-server.onrender.com
```

### 步骤 2：部署 / Step 2: Deploy

1. 将代码推送到 GitHub
2. 在 Vercel 中导入项目
3. Vercel 会自动检测并部署

---

## 本地开发 / Local Development

### 方式 1：使用 .env 文件 / Method 1: Using .env File

创建 `.env` 文件：
```bash
cp .env.example .env
```

编辑 `.env` 文件，设置你的服务器地址（如果需要）：
```
VITE_SOCKET_SERVER_URL=http://localhost:3000
```

### 方式 2：直接使用默认值 / Method 2: Use Default Value

项目默认使用 `http://localhost:3000`，所以可以直接：

```bash
# 终端 1 - 启动 Socket.IO 服务器
npm run server

# 终端 2 - 启动前端开发服务器
npm run dev
```

---

## 完整架构 / Full Architecture

```
┌─────────────────┐         ┌──────────────────────┐
│   前端 (Vercel) │◄───────►│ Socket.IO 服务器     │
│                 │  WebSocket                     │
│  React + Vite   │         │  Node.js + Express   │
└─────────────────┘         └──────────────────────┘
         │                              │
         └──────────────────────────────┘
             多人对战通信
             Multiplayer Communication
```

---

## 平台对比 / Platform Comparison

| 平台 | 免费额度 | 部署难度 | 推荐度 |
|------|---------|---------|--------|
| Render | 免费额度较好 | ⭐ 简单 | ⭐⭐⭐⭐⭐ |
| Railway | 免费额度有限 | ⭐ 简单 | ⭐⭐⭐⭐ |
| Fly.io | 免费额度较好 | ⭐⭐ 中等 | ⭐⭐⭐⭐ |
| Heroku | 无免费 | ⭐⭐ 中等 | ⭐⭐⭐ |
| AWS EC2 | 12个月免费 | ⭐⭐⭐ 困难 | ⭐⭐⭐ |

---

## 故障排除 / Troubleshooting

### Socket.IO 连接失败
- 检查服务器地址是否正确
- 确认服务器正在运行
- 检查 CORS 配置

### CORS 错误
服务器已配置 `cors: { origin: "*" }`，应该不会有问题。

---

## 更多帮助 / More Help

如有问题，请查看：
- [Vercel 文档](https://vercel.com/docs)
- [Socket.IO 文档](https://socket.io/docs)
- [Render 文档](https://render.com/docs)
