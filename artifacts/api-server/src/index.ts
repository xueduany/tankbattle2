import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import app from "./app";
import { logger } from "./lib/logger";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const httpServer = createServer(app);

const io = new SocketIOServer(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
  path: "/socket.io",
});

// 房间存储
const rooms = new Map<string, {
  hostId: string;
  players: Map<string, { playerId: string; ready: boolean }>;
  gameState: unknown;
  started: boolean;
}>();

function generateRoomCode(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

io.on("connection", (socket) => {
  logger.info({ socketId: socket.id }, "新用户连接");

  socket.on("createRoom", () => {
    let roomCode = generateRoomCode();
    while (rooms.has(roomCode)) {
      roomCode = generateRoomCode();
    }

    const roomData = {
      hostId: socket.id,
      players: new Map([[socket.id, { playerId: "p1", ready: true }]]),
      gameState: null,
      started: false,
    };

    rooms.set(roomCode, roomData);
    socket.join(roomCode);

    logger.info({ roomCode }, "房间创建");
    socket.emit("roomCreated", { roomCode, playerId: "p1" });
  });

  socket.on("joinRoom", (roomCode: string) => {
    const room = rooms.get(roomCode);

    if (!room) {
      socket.emit("roomNotFound");
      return;
    }

    if (room.started) {
      socket.emit("roomStarted");
      return;
    }

    const existingPlayerIds = Array.from(room.players.values()).map((p) => p.playerId);
    const allPlayerIds = ["p1", "p2", "p3", "p4"];
    const assignedPlayerId = allPlayerIds.find((id) => !existingPlayerIds.includes(id));

    if (!assignedPlayerId) {
      socket.emit("roomFull");
      return;
    }

    room.players.set(socket.id, { playerId: assignedPlayerId, ready: true });
    socket.join(roomCode);

    logger.info({ roomCode, playerId: assignedPlayerId }, "玩家加入");
    socket.emit("joinedRoom", { roomCode, playerId: assignedPlayerId });

    const playerList = Array.from(room.players.values()).map((p) => p.playerId);
    io.to(roomCode).emit("playerListUpdated", {
      players: ["p1 (主机)", ...playerList.filter((p) => p !== "p1").map((p) => p.toUpperCase())],
    });
  });

  socket.on("startGame", (roomCode: string) => {
    const room = rooms.get(roomCode);
    if (!room || room.hostId !== socket.id) return;

    room.started = true;
    io.to(roomCode).emit("gameStarted");
    logger.info({ roomCode }, "游戏开始");
  });

  socket.on("playerInput", ({ roomCode, playerId, input }: { roomCode: string; playerId: string; input: unknown }) => {
    const room = rooms.get(roomCode);
    if (!room) return;

    socket.to(roomCode).emit("remotePlayerInput", { playerId, input });
  });

  socket.on("gameState", ({ roomCode, state }: { roomCode: string; state: unknown }) => {
    const room = rooms.get(roomCode);
    if (!room) return;

    room.gameState = state;
    socket.to(roomCode).emit("gameStateUpdated", state);
  });

  socket.on("restartGame", (roomCode: string) => {
    const room = rooms.get(roomCode);
    if (!room || room.hostId !== socket.id) return;

    io.to(roomCode).emit("gameRestarted");
  });

  socket.on("disconnect", () => {
    logger.info({ socketId: socket.id }, "用户断开连接");

    for (const [roomCode, room] of rooms.entries()) {
      if (room.players.has(socket.id)) {
        const leavingPlayerId = room.players.get(socket.id)?.playerId;
        room.players.delete(socket.id);

        logger.info({ roomCode, playerId: leavingPlayerId }, "玩家离开房间");

        if (room.players.size === 0) {
          rooms.delete(roomCode);
          logger.info({ roomCode }, "房间已删除");
        } else {
          const playerList = Array.from(room.players.values()).map((p) => p.playerId);
          const displayList = ["p1 (主机)", ...playerList.filter((p) => p !== "p1").map((p) => p.toUpperCase())];
          io.to(roomCode).emit("playerLeft", {
            playerId: leavingPlayerId,
            players: displayList,
          });

          if (room.hostId === socket.id) {
            io.to(roomCode).emit("hostLeft");
            rooms.delete(roomCode);
            logger.info({ roomCode }, "主机离开，房间关闭");
          }
        }
        break;
      }
    }
  });
});

httpServer.listen(port, () => {
  logger.info({ port }, "Socket.IO + API Server listening");
});
