import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';

const app = express();
const httpServer = createServer(app);

// 配置 Socket.IO，允许跨域
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// 房间存储
const rooms = new Map();

// 生成房间码
function generateRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// 监听连接
io.on('connection', (socket) => {
  console.log('新用户连接:', socket.id);

  // 创建房间
  socket.on('createRoom', () => {
    // 生成唯一房间码
    let roomCode = generateRoomCode();
    while (rooms.has(roomCode)) {
      roomCode = generateRoomCode();
    }
    
    // 初始化房间数据
    const roomData = {
      hostId: socket.id,
      players: new Map([[socket.id, { playerId: 'p1', ready: true }]]),
      gameState: null,
      started: false
    };
    
    rooms.set(roomCode, roomData);
    socket.join(roomCode);
    
    console.log('房间创建:', roomCode);
    socket.emit('roomCreated', { roomCode, playerId: 'p1' });
  });

  // 加入房间
  socket.on('joinRoom', (roomCode) => {
    const room = rooms.get(roomCode);
    
    if (!room) {
      socket.emit('roomNotFound');
      return;
    }
    
    if (room.started) {
      socket.emit('roomAlreadyStarted');
      return;
    }
    
    // 分配玩家ID
    const existingPlayerIds = Array.from(room.players.values()).map(p => p.playerId);
    let assignedPlayerId = null;
    
    for (const pid of ['p2', 'p3', 'p4']) {
      if (!existingPlayerIds.includes(pid)) {
        assignedPlayerId = pid;
        break;
      }
    }
    
    if (!assignedPlayerId) {
      socket.emit('roomFull');
      return;
    }
    
    // 加入房间
    room.players.set(socket.id, { playerId: assignedPlayerId, ready: true });
    socket.join(roomCode);
    
    console.log('玩家加入房间:', roomCode, '作为', assignedPlayerId);
    
    // 通知新加入的玩家
    socket.emit('joinedRoom', { roomCode, playerId: assignedPlayerId });
    
    // 通知房间里所有玩家（包括新加入的）
    const playerList = Array.from(room.players.values()).map(p => p.playerId);
    io.to(roomCode).emit('playerListUpdated', { 
      players: ['p1 (主机)', ...playerList.filter(p => p !== 'p1').map(p => p.toUpperCase())] 
    });
  });

  // 开始游戏
  socket.on('startGame', (roomCode) => {
    const room = rooms.get(roomCode);
    if (!room || room.hostId !== socket.id) return;
    
    room.started = true;
    io.to(roomCode).emit('gameStarted');
    console.log('游戏开始:', roomCode);
  });

  // 游戏输入（客机 -> 服务器）
  socket.on('playerInput', ({ roomCode, playerId, input }) => {
    const room = rooms.get(roomCode);
    if (!room) return;
    
    // 广播输入给房间里所有玩家（包括主机）
    socket.to(roomCode).emit('remotePlayerInput', { playerId, input });
  });

  // 游戏状态（主机 -> 服务器 -> 客机）
  socket.on('gameState', ({ roomCode, state }) => {
    const room = rooms.get(roomCode);
    if (!room) return;
    
    room.gameState = state;
    socket.to(roomCode).emit('gameStateUpdated', state);
  });

  // 重启游戏
  socket.on('restartGame', (roomCode) => {
    const room = rooms.get(roomCode);
    if (!room || room.hostId !== socket.id) return;
    
    io.to(roomCode).emit('gameRestarted');
  });

  // 断开连接
  socket.on('disconnect', () => {
    console.log('用户断开连接:', socket.id);
    
    // 查找用户所在的房间并清理
    for (const [roomCode, room] of rooms.entries()) {
      if (room.players.has(socket.id)) {
        const leavingPlayerId = room.players.get(socket.id).playerId;
        room.players.delete(socket.id);
        
        console.log('玩家离开房间:', roomCode, leavingPlayerId);
        
        // 如果房间没人了，删除房间
        if (room.players.size === 0) {
          rooms.delete(roomCode);
          console.log('房间已删除:', roomCode);
        } else {
          // 通知房间里其他玩家
          const playerList = Array.from(room.players.values()).map(p => p.playerId);
          const displayList = ['p1 (主机)', ...playerList.filter(p => p !== 'p1').map(p => p.toUpperCase())];
          io.to(roomCode).emit('playerLeft', { 
            playerId: leavingPlayerId,
            players: displayList 
          });
          
          // 如果主机离开，关闭房间或转移主机（简单起见就直接让客机退出）
          if (room.hostId === socket.id) {
            io.to(roomCode).emit('hostLeft');
            rooms.delete(roomCode);
            console.log('主机离开，房间关闭:', roomCode);
          }
        }
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3000;

httpServer.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║   🎮 多人坦克大战服务器已启动! 🎮                           ║
║                                                               ║
║   Socket.IO 服务器: http://localhost:${PORT}                  ║
║                                                               ║
║   使用说明:                                                  ║
║   - 请同时在另一个终端运行: npm run dev                     ║
║   - 前端会连接到此 Socket.IO 服务器进行多人对战               ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
  `);
});
