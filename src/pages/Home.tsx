/*
设计承诺：街机军械库 / Brutalist HUD
- 高对比煤黑 + 警戒黄 + 炮火橙，形成战场警报感
- 破格斜切面板、扫描线、像素网格贯穿所有界面
- 触控按钮要像实体军械开关，反馈明显而不是轻微
- 游戏区保持横屏优先，但竖屏也能操作
*/

// ============== Socket.IO 网络配置 ==============
// 配置 Socket.IO 服务器地址
// - 本地开发: "http://localhost:3000"
// - 生产环境: 改为你的 Socket.IO 服务器地址，如 "https://your-socket-server.onrender.com"
const SERVER_URL = import.meta.env.VITE_SOCKET_SERVER_URL || "http://localhost:3000";
// ==============================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import * as THREE from "three";
import { motion, AnimatePresence } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { CircleHelp, Copy, Crosshair, Gamepad2, LogOut, Palette, RadioTower, Shield, Smartphone, Swords, X, Zap } from "lucide-react";

interface HomeProps {
  targetSection?: string;
}

type PlayerId = "p1" | "p2" | "p3" | "p4";
type Role = "menu" | "host" | "guest";
type Phase = "lobby" | "playing" | "ended";
type Message =
  | { type: "join" }
  | { type: "assign"; playerId: PlayerId }
  | { type: "input"; input: PlayerInput }
  | { type: "state"; state: GameState }
  | { type: "restart" };

type PlayerInput = {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  fire: boolean;
  suicide: boolean; // 自爆
};

type Tank = {
  id: PlayerId;
  x: number;
  y: number;
  angle: number;
  hp: number;
  cooldown: number;
  crashCooldown: number;
  score: number;
  color: string;
  alive: boolean;
  respawn: number;
  deathTime: number; // 记录死亡时间（帧）
};

type Bullet = {
  id: string;
  owner: PlayerId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
};

type Explosion = {
  id: string;
  x: number;
  y: number;
  t: number;
};

type Debris = {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  rotSpeed: number;
  color: number;
  t: number;
  size: number;
};

type Pedestrian = {
  id: string;
  x: number;
  y: number;
  angle: number; // 行走方向
  speed: number;
  color: number;
  alive: boolean;
  changeDirectionTimer: number; // 改变方向的计时器
  deathTimer: number; // 倒地后的计时
  bloodX: number; // 血迹位置
  bloodY: number;
  deathAngle: number; // 死亡时的角度（固定）
  bloodSize: number; // 血迹大小（固定）
  splatterData: Array<{ size: number; angle: number; dist: number }>; // 溅血数据（固定）
};

type GameState = {
  phase: Phase;
  frame: number;
  tanks: Record<PlayerId, Tank>;
  bullets: Bullet[];
  explosions: Explosion[];
  debris: Debris[];
  pedestrians: Pedestrian[]; // 路人NPC
  winner?: PlayerId;
  mapSeed: number;
  refreshTimer: number;
  explored: Record<PlayerId, boolean[]>;
  // 追踪最后看到敌人的时间
  lastSeenEnemy: Record<PlayerId, number>;
  // 标记是否正在显示提示
  showingHint: Record<PlayerId, boolean>;
};

const W = 1920;
const H = 1080;
const TANK_R = 18;
const BULLET_R = 5;
const MAP_REFRESH_TICKS = 60 * 30;
const MAP_REFRESH_WARNING_TICKS = 60 * 5;
const RESPAWN_TICKS = 60 * 5;
const FOG_CELL = 24;
const FOG_COLS = Math.ceil(W / FOG_CELL);
const FOG_ROWS = Math.ceil(H / FOG_CELL);
const FOG_COUNT = FOG_COLS * FOG_ROWS;
const REVEAL_RADIUS = 264 * 2;
const WALLS = [
  { x: 232, y: 184, w: 104, h: 360 },
  { x: 476, y: 768, w: 376, h: 84 },
  { x: 884, y: 252, w: 152, h: 492 },
  { x: 1252, y: 148, w: 428, h: 84 },
  { x: 1484, y: 512, w: 96, h: 404 },
  { x: 176, y: 888, w: 192, h: 68 },
  { x: 1144, y: 832, w: 184, h: 72 },
];

// 河流系统：河流不可通过坦克，但子弹可以穿过
const RIVERS = [
  // 上方横向河流
  { x: 200, y: 400, w: 600, h: 70 },
  // 下方横向河流
  { x: 1100, y: 600, w: 600, h: 70 },
];
// 河流检测函数
function isInRiver(x: number, y: number, r: number) {
  return RIVERS.some(river => hitRectCircle(river, x, y, r));
}
const EMPTY_INPUT: PlayerInput = { up: false, down: false, left: false, right: false, fire: false, suicide: false };

const PLAYER_COLORS: Record<PlayerId, string> = {
  p1: "#ffcf33",
  p2: "#36e0ff",
  p3: "#ff6b6b",
  p4: "#51cf66",
};

const ALL_PLAYERS: PlayerId[] = ["p1", "p2", "p3", "p4"];

type TankStyleId = "vanguard" | "raptor" | "atlas" | "specter";
const TANK_STYLES: Record<TankStyleId, { name: string; desc: string; primary: string; secondary: string; body: string; shape: "classic" | "speed" | "heavy" | "stealth" }> = {
  vanguard: { name: "先锋黄蜂", desc: "均衡履带，炮塔醒目", primary: "#ffd43b", secondary: "#ff7a1a", body: "#304a2a", shape: "classic" },
  raptor: { name: "蓝电猛禽", desc: "低矮车身，速度感强", primary: "#38d9ff", secondary: "#7c5cff", body: "#173f5f", shape: "speed" },
  atlas: { name: "赤铜巨像", desc: "重装宽体，掩体感强", primary: "#ff6b4a", secondary: "#ffd166", body: "#6b3f24", shape: "heavy" },
  specter: { name: "薄荷幽灵", desc: "斜切装甲，轮廓锐利", primary: "#69f0ae", secondary: "#f6ff6b", body: "#23443b", shape: "stealth" },
};
const STYLE_IDS = Object.keys(TANK_STYLES) as TankStyleId[];
const MAP_SEED_STORAGE_KEY = "mobile-tank-duel-map-seed";

function getInitialMapSeed() {
  if (typeof window === "undefined") return Date.now();
  const saved = window.sessionStorage.getItem(MAP_SEED_STORAGE_KEY);
  const parsed = saved ? Number(saved) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : Date.now();
}

function persistMapSeed(seed: number) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(MAP_SEED_STORAGE_KEY, String(seed));
}

// 使用Web Speech API播放NPC死亡语音
function playDeathVoice(synth: SpeechSynthesis) {
  const utterances = [
    "Fuck you!",
    "Help me!",
    "Oh no!",
    "Aaaah!",
    "Help!",
    "Please!",
    "Ouch!"
  ];
  
  const text = utterances[Math.floor(Math.random() * utterances.length)];
  const utterance = new SpeechSynthesisUtterance(text);
  
  // 使用最简单的设置，不指定语音，让浏览器使用默认
  utterance.lang = 'en-US';
  utterance.pitch = 1.0;
  utterance.rate = 1.0;
  utterance.volume = 1.0;
  
  console.log('🔊 Playing death voice:', text);
  
  try {
    // 先取消之前可能正在播放的语音
    synth.cancel();
    // 然后播放新语音
    synth.speak(utterance);
    console.log('✅ Voice playback initiated');
  } catch (e) {
    console.error('❌ Error playing voice:', e);
  }
}

function freshState(playersOrAll: PlayerId[] | boolean = ["p1", "p2"]): GameState {
  const mapSeed = getInitialMapSeed();
  const walls = generateWalls(mapSeed);
  
  // 确定活跃玩家
  let activePlayers: PlayerId[];
  if (Array.isArray(playersOrAll)) {
    activePlayers = playersOrAll;
  } else if (playersOrAll === true) {
    activePlayers = ALL_PLAYERS;
  } else {
    activePlayers = ["p1", "p2"];
  }
  
  const tanks: GameState["tanks"] = {} as any;
  const explored: GameState["explored"] = {} as any;
  const lastSeenEnemy: GameState["lastSeenEnemy"] = {} as any;
  const showingHint: GameState["showingHint"] = {} as any;
  
  const spawns: Array<{x: number, y: number, a: number}> = [];
  for (let i = 0; i < activePlayers.length; i++) {
    const exclude = i > 0 ? spawns[i - 1] : undefined;
    spawns.push(randomSpawn(walls, exclude));
  }
  
  activePlayers.forEach((playerId, index) => {
    const spawn = spawns[index];
    tanks[playerId] = { 
      id: playerId, 
      x: spawn.x, 
      y: spawn.y, 
      angle: spawn.a, 
      hp: 5, 
      cooldown: 0, 
      crashCooldown: 0, 
      score: 0, 
      color: PLAYER_COLORS[playerId], 
      alive: true, 
      respawn: 0, 
      deathTime: 0 
    };
    explored[playerId] = Array(FOG_COUNT).fill(false);
    lastSeenEnemy[playerId] = 0;
    showingHint[playerId] = false;
  });
  
  return {
    phase: "lobby",
    frame: 0,
    mapSeed,
    refreshTimer: MAP_REFRESH_TICKS,
    bullets: [],
    explosions: [],
    debris: [],
    pedestrians: generatePedestrians(walls, mapSeed),
    tanks,
    explored,
    lastSeenEnemy,
    showingHint,
  };
}

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}
function hitRectCircle(rect: { x: number; y: number; w: number; h: number }, cx: number, cy: number, r: number) {
  const nx = clamp(cx, rect.x, rect.x + rect.w);
  const ny = clamp(cy, rect.y, rect.y + rect.h);
  return Math.hypot(cx - nx, cy - ny) < r;
}
function blocked(x: number, y: number, r: number, walls = WALLS) {
  if (x < r || y < r || x > W - r || y > H - r) return true;
  if (isInRiver(x, y, r)) return true; // 坦克不能穿过河流
  return walls.some((wall) => hitRectCircle(wall, x, y, r));
}
function roomCode() {
  return `TANK-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}
function createSeededRandom(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
function generateWalls(seed: number) {
  const rand = createSeededRandom(seed);
  const walls: { x: number; y: number; w: number; h: number }[] = [];
  const target = 8 + Math.floor(rand() * 6); // 减少目标数量，更容易达到
  const riverSpacing = 60; // 减少与河流的间距，更容易生成
  for (let i = 0; i < 500 && walls.length < target; i += 1) {
    const horizontal = rand() > 0.5;
    // 减小墙壁尺寸，更容易生成
    const w = horizontal ? 120 + rand() * 180 : 60 + rand() * 80;
    const h = horizontal ? 50 + rand() * 80 : 120 + rand() * 200;
    const x = 60 + rand() * (W - w - 120);
    const y = 60 + rand() * (H - h - 120);
    const wall = { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
    // 放松中心区域稍微放宽一点
    const tooCentral = wall.x < W * 0.55 && wall.x + wall.w > W * 0.45 && wall.y < H * 0.55 && wall.y + wall.h > H * 0.45;
    const overlaps = walls.some((other) => !(wall.x + wall.w + 40 < other.x || other.x + other.w + 40 < wall.x || wall.y + wall.h + 40 < other.y || other.y + other.h + 40 < wall.y));
    // 墙壁与河流之间保持至少 riverSpacing 的间距
    const nearRiver = RIVERS.some(river => !(wall.x + wall.w + riverSpacing < river.x || river.x + river.w + riverSpacing < wall.x || wall.y + wall.h + riverSpacing < river.y || river.y + river.h + riverSpacing < wall.y));
    if (!tooCentral && !overlaps && !nearRiver) walls.push(wall);
  }
  return walls;
}
function randomSpawn(walls = WALLS, exclude?: { x: number; y: number }) {
  for (let i = 0; i < 200; i += 1) {
    const x = 56 + Math.random() * (W - 112);
    const y = 56 + Math.random() * (H - 112);
    if (blocked(x, y, TANK_R + 10, walls)) continue;
    if (isInRiver(x, y, TANK_R + 10)) continue; // 不能在河里生成
    if (exclude && Math.hypot(x - exclude.x, y - exclude.y) < 360) continue; // 距离也增大一倍
    return { x, y, a: Math.random() * Math.PI * 2 };
  }
  return exclude ? { x: clamp(W - exclude.x, 64, W - 64), y: clamp(H - exclude.y, 64, H - 64), a: Math.random() * Math.PI * 2 } : { x: W / 4, y: H / 4, a: 0 };
}

// 生成路人NPC
function generatePedestrians(walls: any[], mapSeed: number): Pedestrian[] {
  const pedestrians: Pedestrian[] = [];
  const rand = createSeededRandom(mapSeed);
  const count = 8 + Math.floor(rand() * 8); // 8-16个路人
  
  const pedestrianColors = [0xff69b4, 0x87ceeb, 0x98fb98, 0xffd700, 0xff6347, 0xdda0dd];
  
  for (let i = 0; i < count; i++) {
    // 找到一个安全的生成位置
    let x, y;
    let valid = false;
    for (let j = 0; j < 100 && !valid; j++) {
      x = 60 + rand() * (W - 120);
      y = 60 + rand() * (H - 120);
      // 不能在墙内或河里
      if (blocked(x, y, 8, walls)) continue;
      if (isInRiver(x, y, 8)) continue;
      valid = true;
    }
    
    if (valid) {
      pedestrians.push({
        id: `ped-${i}-${mapSeed}`,
        x: x!,
        y: y!,
        angle: rand() * Math.PI * 2,
        speed: 0.5 + rand() * 0.5,
        color: pedestrianColors[Math.floor(rand() * pedestrianColors.length)],
        alive: true,
        changeDirectionTimer: Math.floor(rand() * 120) + 60, // 1-3秒改变方向
        deathTimer: 0,
        bloodX: 0,
        bloodY: 0,
        deathAngle: 0,
        bloodSize: 0,
        splatterData: [],
      });
    }
  }
  
  return pedestrians;
}
function refreshBattlefield(state: GameState, enableAllPlayers = false) {
  const mapSeed = Date.now() + state.frame;
  persistMapSeed(mapSeed);
  const walls = generateWalls(mapSeed);
  
  const activePlayers: PlayerId[] = Object.keys(state.tanks) as PlayerId[];
  
  const tanks: GameState["tanks"] = {} as any;
  const explored: GameState["explored"] = {} as any;
  const lastSeenEnemy: GameState["lastSeenEnemy"] = {} as any;
  const showingHint: GameState["showingHint"] = {} as any;
  
  const spawns: Array<{x: number, y: number, a: number}> = [];
  for (let i = 0; i < activePlayers.length; i++) {
    const exclude = i > 0 ? spawns[i - 1] : undefined;
    spawns.push(randomSpawn(walls, exclude));
  }
  
  activePlayers.forEach((playerId, index) => {
    const spawn = spawns[index];
    tanks[playerId] = { 
      ...state.tanks[playerId],
      x: spawn.x, 
      y: spawn.y, 
      angle: spawn.a, 
      hp: 5, 
      cooldown: 20, 
      alive: true, 
      respawn: 0, 
      deathTime: 0 
    };
    explored[playerId] = Array(FOG_COUNT).fill(false);
    lastSeenEnemy[playerId] = mapSeed;
    showingHint[playerId] = false;
  });
  
  return {
    ...state,
    mapSeed,
    refreshTimer: MAP_REFRESH_TICKS,
    bullets: [],
    explosions: [],
    debris: [],
    pedestrians: generatePedestrians(walls, mapSeed),
    tanks,
    explored,
    lastSeenEnemy,
    showingHint,
  };
}

function revealAround(explored: boolean[], x: number, y: number) {
  const minC = clamp(Math.floor((x - REVEAL_RADIUS) / FOG_CELL), 0, FOG_COLS - 1);
  const maxC = clamp(Math.floor((x + REVEAL_RADIUS) / FOG_CELL), 0, FOG_COLS - 1);
  const minR = clamp(Math.floor((y - REVEAL_RADIUS) / FOG_CELL), 0, FOG_ROWS - 1);
  const maxR = clamp(Math.floor((y + REVEAL_RADIUS) / FOG_CELL), 0, FOG_ROWS - 1);
  for (let r = minR; r <= maxR; r++) {
    for (let c = minC; c <= maxC; c++) {
      const cx = c * FOG_CELL + FOG_CELL / 2;
      const cy = r * FOG_CELL + FOG_CELL / 2;
      if (Math.hypot(cx - x, cy - y) <= REVEAL_RADIUS) explored[r * FOG_COLS + c] = true;
    }
  }
}

function isExplored(explored: boolean[] | undefined, x: number, y: number) {
  if (!explored) return false;
  const c = clamp(Math.floor(x / FOG_CELL), 0, FOG_COLS - 1);
  const r = clamp(Math.floor(y / FOG_CELL), 0, FOG_ROWS - 1);
  return !!explored[r * FOG_COLS + c];
}

function isCurrentlyVisible(tank: Tank, x: number, y: number) {
  return tank.alive && Math.hypot(tank.x - x, tank.y - y) <= REVEAL_RADIUS;
}

// 生成坦克爆炸碎片
function generateDebris(tank: Tank, frame: number): Debris[] {
  const debris: Debris[] = [];
  const count = 20 + Math.floor(Math.random() * 15); // 20-35个碎片，更多更明显
  const colorMap: Record<string, number[]> = {
    "#ffcf33": [0xffcf33, 0xffa500, 0xff6b4a, 0x8b4513, 0x2f4f4f],
    "#36e0ff": [0x36e0ff, 0x1e90ff, 0x4169e1, 0x2f4f4f, 0xffcf33]
  };
  const colors = colorMap[tank.color] || [0xffcf33, 0xffa500, 0x8b4513, 0x2f4f4f];
  
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i / count) + (Math.random() - 0.5) * 1.2;
    const speed = 4 + Math.random() * 8; // 更快的速度
    debris.push({
      id: `${tank.id}-${frame}-${i}`,
      x: tank.x,
      y: tank.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      rot: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.5, // 更快的旋转
      color: colors[Math.floor(Math.random() * colors.length)],
      t: 90 + Math.floor(Math.random() * 60), // 更长的显示时间
      size: 6 + Math.random() * 12 // 更大的碎片
    });
  }
  return debris;
}

function stepGame(prev: GameState, inputs: Record<PlayerId, PlayerInput>): GameState {
  if (prev.phase !== "playing") return prev;
  const walls = generateWalls(prev.mapSeed);
  
  const activePlayers: PlayerId[] = Object.keys(prev.tanks) as PlayerId[];
  
  const tanks: GameState["tanks"] = {} as any;
  const explored: GameState["explored"] = {} as any;
  
  activePlayers.forEach(playerId => {
    tanks[playerId] = { ...prev.tanks[playerId] };
    explored[playerId] = [...prev.explored[playerId]];
  });
  
  const next: GameState = {
    ...prev,
    frame: prev.frame + 1,
    refreshTimer: prev.refreshTimer - 1,
    bullets: prev.bullets.map((b) => ({ ...b })),
    explosions: prev.explosions.map((e) => ({ ...e, t: e.t - 1 })).filter((e) => e.t > 0),
    debris: prev.debris.map((d) => ({
      ...d,
      x: d.x + d.vx,
      y: d.y + d.vy,
      vx: d.vx * 0.98,
      vy: d.vy * 0.98,
      rot: d.rot + d.rotSpeed,
      t: d.t - 1
    })).filter((d) => d.t > 0),
    pedestrians: prev.pedestrians.map(p => ({ ...p })),
    tanks,
    explored,
    lastSeenEnemy: { ...prev.lastSeenEnemy },
    showingHint: { ...prev.showingHint },
  };

  // 检查是否能看到敌人，更新最后看到的时间
  activePlayers.forEach((playerId) => {
    const player = next.tanks[playerId];
    // 对所有其他玩家检查可见性
    activePlayers.forEach(enemyId => {
      if (enemyId === playerId) return;
      const enemy = next.tanks[enemyId];
      if (player.alive && enemy.alive) {
        const dist = Math.hypot(player.x - enemy.x, player.y - enemy.y);
        const canSeeEnemy = dist <= REVEAL_RADIUS;
        
        if (canSeeEnemy) {
          next.lastSeenEnemy[playerId] = next.frame;
          next.showingHint[playerId] = false;
        }
      }
    });
    
    // 检查是否显示提示
    const timeSinceSeen = next.frame - next.lastSeenEnemy[playerId];
    if (timeSinceSeen >= 600 && timeSinceSeen < 720) {
      next.showingHint[playerId] = true;
    } else if (timeSinceSeen >= 720 && next.showingHint[playerId]) {
      next.lastSeenEnemy[playerId] = next.frame - 600;
      next.showingHint[playerId] = false;
    }
  });

  (Object.keys(next.tanks) as PlayerId[]).forEach((id) => {
    const t = next.tanks[id];
    if (t.alive) revealAround(next.explored[id], t.x, t.y);
    if (!t.alive) {
      t.respawn -= 1;
      if (t.respawn <= 0) {
        const other = next.tanks[id === "p1" ? "p2" : "p1"];
        const spawn = randomSpawn(walls, other.alive ? { x: other.x, y: other.y } : undefined);
        Object.assign(t, { x: spawn.x, y: spawn.y, angle: spawn.a, hp: 5, alive: true, cooldown: 18, crashCooldown: 0, deathTime: 0 });
      }
      return;
    }
    const input = inputs[id] ?? EMPTY_INPUT;
    
    // 自杀逻辑
    if (input.suicide && t.hp > 0) {
      t.hp = 0;
      t.alive = false;
      t.respawn = RESPAWN_TICKS;
      t.deathTime = next.frame;
      next.explosions.push({ id: `suicide-boom-${next.frame}`, x: t.x, y: t.y, t: 34 });
      next.debris.push(...generateDebris(t, next.frame));
      
      // 自爆炸死附近的NPC
      const explosionRadius = 250; // 爆炸半径（放大5倍）
      next.pedestrians.forEach(ped => {
        if (ped.alive) {
          const dist = Math.hypot(ped.x - t.x, ped.y - t.y);
          if (dist < explosionRadius) {
            // NPC被爆炸炸死
            ped.alive = false;
            ped.deathTimer = 180;
            ped.bloodX = ped.x;
            ped.bloodY = ped.y;
            ped.deathAngle = ped.angle + (Math.random() * 0.5);
            ped.bloodSize = 12 + Math.random() * 8;
            ped.splatterData = [];
            for (let i = 0; i < 5; i++) {
              ped.splatterData.push({
                size: 2 + Math.random() * 4,
                angle: Math.random() * Math.PI * 2,
                dist: 6 + Math.random() * 10,
              });
            }
          }
        }
      });
      
      return;
    }
    
    const rot = 0.075;
    const speed = input.down ? -2.0 : 2.6;
    if (input.left) t.angle -= rot;
    if (input.right) t.angle += rot;
    if (input.up || input.down) {
      const nx = t.x + Math.cos(t.angle) * speed;
      const ny = t.y + Math.sin(t.angle) * speed;
      if (!blocked(nx, t.y, TANK_R, walls)) t.x = nx;
      if (!blocked(t.x, ny, TANK_R, walls)) t.y = ny;
    }
    t.cooldown = Math.max(0, t.cooldown - 1);
    t.crashCooldown = Math.max(0, t.crashCooldown - 1);
    if (input.fire && t.cooldown === 0) {
      t.cooldown = 24;
      next.bullets.push({
        id: `${id}-${next.frame}-${Math.random()}`,
        owner: id,
        x: t.x + Math.cos(t.angle) * 25,
        y: t.y + Math.sin(t.angle) * 25,
        vx: Math.cos(t.angle) * 7.2,
        vy: Math.sin(t.angle) * 7.2,
        life: 92,
      });
    }
  });

  // 坦克碰撞检测 - 撞击扣血 + 物理推开（多玩家版本）
  const tankArray = activePlayers.map(id => next.tanks[id]).filter(t => t.alive);
  
  // 记录哪些对已经处理过碰撞，避免重复计算
  const processedPairs = new Set<string>();
  
  for (let i = 0; i < tankArray.length; i++) {
    for (let j = i + 1; j < tankArray.length; j++) {
      const t1 = tankArray[i];
      const t2 = tankArray[j];
      const pairKey = [t1.id, t2.id].sort().join("-");
      
      if (processedPairs.has(pairKey)) continue;
      processedPairs.add(pairKey);
      
      const dx = t1.x - t2.x;
      const dy = t1.y - t2.y;
      const dist = Math.hypot(dx, dy);
      const minDist = TANK_R * 2;
      
      if (dist < minDist) {
        // 两个坦克相撞！
        const t1Input = inputs[t1.id] ?? EMPTY_INPUT;
        const t2Input = inputs[t2.id] ?? EMPTY_INPUT;
        const t1IsMoving = t1Input.up || t1Input.down || t1Input.left || t1Input.right;
        const t2IsMoving = t2Input.up || t2Input.down || t2Input.left || t2Input.right;
        
        // 物理推开效果（即使不扣血也要推开，避免重叠）
        const overlap = minDist - dist;
        const pushForce = overlap * 0.5; // 推开力度
        const nx = dx / dist;
        const ny = dy / dist;
        
        if (!isNaN(nx) && !isNaN(ny)) {
          // 尝试推开两个坦克
          const t1PushX = nx * pushForce;
          const t1PushY = ny * pushForce;
          const t2PushX = -nx * pushForce;
          const t2PushY = -ny * pushForce;
          
          // 只有不被墙壁挡住时才可以推开
          if (!blocked(t1.x + t1PushX, t1.y + t1PushY, TANK_R, walls)) {
            t1.x += t1PushX;
            t1.y += t1PushY;
          }
          if (!blocked(t2.x + t2PushX, t2.y + t2PushY, TANK_R, walls)) {
            t2.x += t2PushX;
            t2.y += t2PushY;
          }
        }

        // 只有冷却时间为0时才扣血！
        if (t1.crashCooldown === 0 && t2.crashCooldown === 0) {
          // 添加撞击爆炸效果
          const centerX = (t1.x + t2.x) / 2;
          const centerY = (t1.y + t2.y) / 2;
          next.explosions.push({ id: `crash-${next.frame}-${t1.id}-${t2.id}`, x: centerX, y: centerY, t: 24 });

          if (t1IsMoving && t2IsMoving) {
            // 双方都在移动，都扣血
            t1.hp -= 1;
            t2.hp -= 1;
          } else if (t1IsMoving) {
            // 只有t1在移动，只扣t2血
            t2.hp -= 1;
          } else if (t2IsMoving) {
            // 只有t2在移动，只扣t1血
            t1.hp -= 1;
          }
          
          // 设置撞击冷却时间（30帧 = 0.5秒）
          t1.crashCooldown = 30;
          t2.crashCooldown = 30;
          
          // 检查死亡
          [t1, t2].forEach(t => {
            if (t.hp <= 0 && t.alive) {
              t.alive = false;
              t.respawn = RESPAWN_TICKS;
              t.deathTime = next.frame; // 记录死亡时间
              // 给击杀者加分
              const killerId = t.id === t1.id ? t2.id : t1.id;
              if (next.tanks[killerId]) {
                next.tanks[killerId].score += 1;
              }
              next.explosions.push({ id: `boom-${next.frame}-${t.id}`, x: t.x, y: t.y, t: 34 });
              // 生成爆炸碎片
              next.debris.push(...generateDebris(t, next.frame));
            }
          });
        }
      }
    }
  }

  const kept: Bullet[] = [];
  for (const b of next.bullets) {
    b.x += b.vx;
    b.y += b.vy;
    b.life -= 1;
    if (b.life <= 0 || blocked(b.x, b.y, BULLET_R, walls)) {
      next.explosions.push({ id: `e-${b.id}`, x: b.x, y: b.y, t: 14 });
      continue;
    }
    let didHit = false;
    (Object.keys(next.tanks) as PlayerId[]).forEach((id) => {
      const t = next.tanks[id];
      if (id !== b.owner && t.alive && Math.hypot(t.x - b.x, t.y - b.y) < TANK_R + BULLET_R) {
        t.hp -= 1;
        didHit = true;
        next.explosions.push({ id: `hit-${b.id}`, x: b.x, y: b.y, t: 20 });
        if (t.hp <= 0) {
          t.alive = false;
          t.respawn = RESPAWN_TICKS;
          t.deathTime = next.frame; // 记录死亡时间
          next.tanks[b.owner].score += 1;
          next.explosions.push({ id: `boom-${b.id}`, x: t.x, y: t.y, t: 34 });
          // 生成爆炸碎片
          next.debris.push(...generateDebris(t, next.frame));
          if (next.tanks[b.owner].score >= 5) {
            next.phase = "ended";
            next.winner = b.owner;
          }
        }
      }
    });
    if (!didHit) kept.push(b);
  }
  next.bullets = kept;

  // 处理路人NPC - 先清理已消失的
  next.pedestrians = next.pedestrians.filter(ped => {
    if (!ped.alive && ped.deathTimer <= 0) {
      return false; // 移除已消失的
    }
    return true;
  });
  
  // 处理剩余路人
  next.pedestrians.forEach((ped, idx) => {
    if (!ped.alive) {
      // 已经死亡，只更新计时器
      if (ped.deathTimer > 0) {
        ped.deathTimer--;
      }
      return;
    }
    
    // 更新计时器
    ped.changeDirectionTimer--;
    
    // 随机改变方向
    if (ped.changeDirectionTimer <= 0) {
      ped.angle = Math.random() * Math.PI * 2;
      ped.changeDirectionTimer = Math.floor(Math.random() * 120) + 60;
    }
    
    // 移动
    const newX = ped.x + Math.cos(ped.angle) * ped.speed;
    const newY = ped.y + Math.sin(ped.angle) * ped.speed;
    
    // 检查是否能移动到新位置（不能进墙或河）
    if (!blocked(newX, newY, 6, walls) && !isInRiver(newX, newY, 6)) {
      ped.x = newX;
      ped.y = newY;
    } else {
      // 碰到障碍，立即改变方向
      ped.angle = Math.random() * Math.PI * 2;
      ped.changeDirectionTimer = Math.floor(Math.random() * 60) + 30;
    }
    
    // 检测坦克碾压
    (Object.values(next.tanks) as Tank[]).forEach(tank => {
      if (tank.alive) {
        const dist = Math.hypot(ped.x - tank.x, ped.y - tank.y);
        if (dist < TANK_R + 8) {
          // 被坦克碾压，倒地
          ped.alive = false;
          ped.deathTimer = 180; // 3秒后消失
          ped.bloodX = ped.x;
          ped.bloodY = ped.y;
          // 记录固定的死亡状态
          ped.deathAngle = ped.angle + (Math.random() * 0.5);
          ped.bloodSize = 12 + Math.random() * 8;
          ped.splatterData = [];
          for (let i = 0; i < 5; i++) {
            ped.splatterData.push({
              size: 2 + Math.random() * 4,
              angle: Math.random() * Math.PI * 2,
              dist: 6 + Math.random() * 10,
            });
          }
        }
      }
    });
  });

  // 检测子弹击杀路人
  next.bullets.forEach(bullet => {
    next.pedestrians.forEach(ped => {
      if (ped.alive) {
          const dist = Math.hypot(bullet.x - ped.x, bullet.y - ped.y);
          if (dist < 10) {
            // 被子弹击杀，倒地
            ped.alive = false;
            ped.deathTimer = 180; // 3秒后消失
            ped.bloodX = ped.x;
            ped.bloodY = ped.y;
            // 记录固定的死亡状态
            ped.deathAngle = ped.angle + (Math.random() * 0.5);
            ped.bloodSize = 12 + Math.random() * 8;
            ped.splatterData = [];
            for (let i = 0; i < 5; i++) {
              ped.splatterData.push({
                size: 2 + Math.random() * 4,
                angle: Math.random() * Math.PI * 2,
                dist: 6 + Math.random() * 10,
              });
            }
            bullet.life = 0; // 子弹消失
          }
        }
    });
  });

  // 检查获胜条件：任何玩家达到5分就结束
  activePlayers.forEach(playerId => {
    if (next.tanks[playerId].score >= 5) {
      next.phase = "ended";
      next.winner = playerId;
    }
  });

  if (next.refreshTimer <= 0) {
    return refreshBattlefield(next);
  }
  return next;
}



function drawMiniMap(ctx: CanvasRenderingContext2D, state: GameState, focus: PlayerId) {
  const walls = generateWalls(state.mapSeed);
  const mw = 214;
  const mh = 132;
  const pad = 14;
  const x = pad;
  const y = H - mh - pad;
  const sx = mw / W;
  const sy = mh / H;
  const explored = state.explored?.[focus] || Array(FOG_COUNT).fill(false);
  const myTank = state.tanks?.[focus];
  
  // 安全检查
  if (!myTank) return;
  
  // 获取所有其他玩家
  const activePlayers = Object.keys(state.tanks || {}) as PlayerId[];
  const otherPlayers = activePlayers.filter(id => id !== focus);

  ctx.save();
  ctx.shadowBlur = 18;
  ctx.shadowColor = "rgba(0,0,0,.8)";
  ctx.fillStyle = "rgba(2,3,2,.92)";
  ctx.fillRect(x, y, mw, mh);
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "#ffcf33";
  ctx.lineWidth = 3;
  ctx.strokeRect(x, y, mw, mh);

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, mw, mh);
  ctx.clip();

  for (let r = 0; r < FOG_ROWS; r++) {
    for (let c = 0; c < FOG_COLS; c++) {
      if (!explored[r * FOG_COLS + c]) continue;
      const wx = c * FOG_CELL;
      const wy = r * FOG_CELL;
      const visibleNow = isCurrentlyVisible(myTank, wx + FOG_CELL / 2, wy + FOG_CELL / 2);
      ctx.fillStyle = visibleNow ? "rgba(255,207,51,.12)" : "rgba(95,88,55,.18)";
      ctx.fillRect(x + wx * sx, y + wy * sy, FOG_CELL * sx + .5, FOG_CELL * sy + .5);
    }
  }

  walls.forEach((wall) => {
    const samples = [
      [wall.x, wall.y], [wall.x + wall.w, wall.y], [wall.x, wall.y + wall.h], [wall.x + wall.w, wall.y + wall.h],
      [wall.x + wall.w / 2, wall.y + wall.h / 2],
    ];
    if (!samples.some(([px, py]) => isExplored(explored, px, py))) return;
    ctx.fillStyle = "#6a5427";
    ctx.fillRect(x + wall.x * sx, y + wall.y * sy, wall.w * sx, wall.h * sy);
    ctx.strokeStyle = "rgba(255,207,51,.42)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x + wall.x * sx, y + wall.y * sy, wall.w * sx, wall.h * sy);
  });

  // 检查是否显示敌人提示，对所有其他敌人
  otherPlayers.forEach(enemyId => {
    const enemy = state.tanks?.[enemyId];
    if (!enemy) return;
    if ((state.showingHint?.[focus] || false) && enemy.alive && myTank.alive) {
      // 闪烁效果
      const flash = Math.floor(state.frame / 10) % 2 === 0;
      if (flash) {
        ctx.fillStyle = enemy.color;
        ctx.globalAlpha = 0.8;
        ctx.beginPath();
        ctx.arc(x + enemy.x * sx, y + enemy.y * sy, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        
        // 添加外圈脉冲效果
        const pulseSize = 10 + Math.sin(state.frame * 0.1) * 3;
        ctx.strokeStyle = enemy.color;
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.6;
        ctx.beginPath();
        ctx.arc(x + enemy.x * sx, y + enemy.y * sy, pulseSize, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
  });

  // 小地图不显示敌人坐标；只显示自己的定位点和已探索地形。
  if (myTank.alive) {
    ctx.fillStyle = myTank.color;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x + myTank.x * sx, y + myTank.y * sy, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + myTank.x * sx, y + myTank.y * sy);
    ctx.lineTo(x + (myTank.x + Math.cos(myTank.angle) * 34) * sx, y + (myTank.y + Math.sin(myTank.angle) * 34) * sy);
    ctx.strokeStyle = myTank.color;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.restore();

  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 5]);
  ctx.beginPath();
  ctx.moveTo(x + myTank.x * sx, y + myTank.y * sy);
  ctx.lineTo(x + (myTank.x + Math.cos(myTank.angle) * REVEAL_RADIUS) * sx, y + (myTank.y + Math.sin(myTank.angle) * REVEAL_RADIUS) * sy);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x + myTank.x * sx, y + myTank.y * sy, REVEAL_RADIUS * sx, myTank.angle - .72, myTank.angle + .72);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.restore();
}

function makeTankMesh(styleId: TankStyleId, fallbackColor: string) {
  const style = TANK_STYLES[styleId] ?? TANK_STYLES.vanguard;
  const color = style.primary || fallbackColor;
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: style.body, roughness: .48, metalness: .28 });
  const accentMat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: .32, roughness: .3, metalness: .5 });
  const secondaryMat = new THREE.MeshStandardMaterial({ color: style.secondary, emissive: style.secondary, emissiveIntensity: .18, roughness: .36, metalness: .38 });
  const dims = style.shape === "heavy" ? [48, 24, 36] : style.shape === "speed" ? [46, 14, 24] : style.shape === "stealth" ? [40, 16, 30] : [38, 18, 28];
  const body = new THREE.Mesh(new THREE.BoxGeometry(dims[0], dims[1], dims[2]), bodyMat);
  body.position.y = 16;
  body.castShadow = true;
  group.add(body);
  const turret = new THREE.Mesh(new THREE.CylinderGeometry(style.shape === "heavy" ? 14 : 10, style.shape === "speed" ? 10 : 12, style.shape === "heavy" ? 13 : 10, 16), accentMat);
  turret.rotation.x = Math.PI / 2;
  turret.position.y = 30;
  turret.castShadow = true;
  group.add(turret);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(style.shape === "heavy" ? 42 : style.shape === "speed" ? 38 : 34, style.shape === "heavy" ? 9 : 7, style.shape === "stealth" ? 5 : 7), secondaryMat);
  barrel.position.set(22, 31, 0);
  barrel.castShadow = true;
  group.add(barrel);
  const leftTrack = new THREE.Mesh(new THREE.BoxGeometry(dims[0] - 4, 8, 8), new THREE.MeshStandardMaterial({ color: 0x162018, roughness: .75 }));
  leftTrack.position.set(0, 8, -18);
  const rightTrack = leftTrack.clone();
  rightTrack.position.z = 18;
  group.add(leftTrack, rightTrack);
  return group;
}

function worldToThree(x: number, y: number, h = 0) {
  return new THREE.Vector3(x - W / 2, h, y - H / 2);
}

function drawHudOverlay(hud: HTMLCanvasElement, state: GameState, focus: PlayerId) {
  const ctx = hud.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, W, H);
  drawMiniMap(ctx, state, focus);
}

function drawGame3D(
  canvas: HTMLCanvasElement,
  hud: HTMLCanvasElement,
  state: GameState,
  focus: PlayerId = "p1",
  rendererRef: React.MutableRefObject<ThreeContext | null>,
  tankStyles: Record<PlayerId, TankStyleId>,
) {
  // 初始化或获取缓存的 Three.js 上下文
  let three = rendererRef.current;
  if (!three) {
    // 首次初始化
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    renderer.setSize(W, H, false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xbfefff);
    scene.fog = new THREE.FogExp2(0xbfefff, 0.0028);

    const camera = new THREE.PerspectiveCamera(58, W / H, 1, 1900);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x8fd98f, 2.35);
    scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff1a6, 3.1);
    sun.position.set(-180, 360, -120);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    scene.add(sun);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(W, H, 32, 18),
      new THREE.MeshStandardMaterial({ color: 0x7fcf6b, roughness: .86, metalness: .02 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    const grid = new THREE.GridHelper(Math.max(W, H), 24, 0xffffff, 0x4bbf73);
    grid.material.opacity = .28;
    grid.material.transparent = true;
    scene.add(grid);

    three = { renderer, scene, camera, hemiLight: hemi, sunLight: sun, ground, grid };
    rendererRef.current = three;
  } else {
    three.renderer.setSize(W, H, false);
  }

  const { renderer, scene, camera } = three;
  
  // 安全检查：确保 state 对象和所有属性都存在
  if (!state) return;
  
  let me = state.tanks?.[focus];
  
  // 安全检查：如果坦克不存在，使用默认值
  if (!me) {
    me = {
      id: focus,
      x: W / 2,
      y: H / 2,
      angle: 0,
      hp: 5,
      score: 0,
      alive: true,
      cooldown: 0,
      crashCooldown: 0,
      color: "#ffcf33",
      respawn: 0,
      deathTime: 0
    };
  }

  // 清除上一帧添加的动态对象（保留静态的灯光、地面、网格）
  for (let i = scene.children.length - 1; i >= 0; i--) {
    const child = scene.children[i];
    if (
      child !== three.hemiLight &&
      child !== three.sunLight &&
      child !== three.ground &&
      child !== three.grid
    ) {
      scene.remove(child);
    }
  }

  // 更新相机位置
  const forward = new THREE.Vector3(Math.cos(me.angle), 0, Math.sin(me.angle));
  const target = worldToThree(me.x, me.y, 28);
  const cameraPos = target.clone().add(forward.clone().multiplyScalar(-148)).add(new THREE.Vector3(0, 124, 0));
  camera.position.copy(cameraPos);
  camera.lookAt(target.clone().add(forward.clone().multiplyScalar(110)).add(new THREE.Vector3(0, -18, 0)));

  const explored = state.explored?.[focus] || Array(FOG_COUNT).fill(false);
  const walls = generateWalls(state.mapSeed);
  const obstaclePalette = [0xffc857, 0x4dabf7, 0xff6b6b, 0x63e6be, 0xb197fc, 0xff922b, 0x94d82d];

  // 渲染河流（先渲染，在墙壁下面）
  RIVERS.forEach((river, i) => {
    const cx = river.x + river.w / 2;
    const cy = river.y + river.h / 2;
    const visible = isCurrentlyVisible(me, cx, cy);
    const known = visible || isExplored(explored, cx, cy);
    if (!known) return;

    // 河流主体（水）
    const waterMat = new THREE.MeshStandardMaterial({
      color: visible ? 0x3b82f6 : 0x475569,
      roughness: .15,
      metalness: .45,
      transparent: true,
      opacity: visible ? .85 : .45,
    });
    const water = new THREE.Mesh(new THREE.PlaneGeometry(river.w, river.h), waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.copy(worldToThree(cx, cy, 2)); // 稍微比地面高一点
    water.receiveShadow = true;
    scene.add(water);

    // 河岸（浅色边框）
    const bankMat = new THREE.MeshStandardMaterial({
      color: visible ? 0x22c55e : 0x475569,
      roughness: .85,
      metalness: .05,
      transparent: !visible,
      opacity: visible ? 1 : .45,
    });
    const bank = new THREE.Mesh(new THREE.BoxGeometry(river.w + 16, 8, river.h + 16), bankMat);
    bank.position.copy(worldToThree(cx, cy, 4));
    bank.receiveShadow = true;
    scene.add(bank);
  });

  walls.forEach((wall, i) => {
    const cx = wall.x + wall.w / 2;
    const cy = wall.y + wall.h / 2;
    const visible = isCurrentlyVisible(me, cx, cy);
    const known = visible || isExplored(explored, cx, cy);
    if (!known) return;
    const height = i % 3 === 0 ? 76 : i % 3 === 1 ? 54 : 42;
    const mat = new THREE.MeshStandardMaterial({
      color: visible ? obstaclePalette[i % obstaclePalette.length] : 0x7b8068,
      roughness: .72,
      metalness: .12,
      transparent: !visible,
      opacity: visible ? 1 : .52,
    });
    const box = new THREE.Mesh(new THREE.BoxGeometry(wall.w, height, wall.h), mat);
    box.position.copy(worldToThree(cx, cy, height / 2));
    box.castShadow = true;
    box.receiveShadow = true;
    scene.add(box);
    const rimColor = obstaclePalette[(i + 2) % obstaclePalette.length];
    const top = new THREE.Mesh(new THREE.BoxGeometry(wall.w + 3, 5, wall.h + 3), new THREE.MeshStandardMaterial({ color: visible ? rimColor : 0xa4ad91, emissive: visible ? rimColor : 0x000000, emissiveIntensity: visible ? .16 : 0, roughness: .38, metalness: .18 }));
    top.position.copy(worldToThree(cx, cy, height + 3));
    top.castShadow = true;
    scene.add(top);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(wall.w + 5, 8, 4), new THREE.MeshStandardMaterial({ color: rimColor, emissive: rimColor, emissiveIntensity: .2 }));
    stripe.position.copy(worldToThree(cx, wall.y, Math.max(14, height * .55)));
    scene.add(stripe);
  });

  (Object.values(state.tanks) as Tank[]).forEach((t) => {
    if (!t) return; // 安全检查
    if (!t.alive) return;
    if (typeof t.x !== 'number' || typeof t.y !== 'number' || typeof t.angle !== 'number') return;
    if (t.id !== focus && !isCurrentlyVisible(me, t.x, t.y)) return;
    const tankMesh = makeTankMesh(tankStyles[t.id], t.color);
    tankMesh.position.copy(worldToThree(t.x, t.y, 0));
    tankMesh.rotation.y = -t.angle;
    scene.add(tankMesh);
  });

  (state.bullets || []).forEach((b) => {
    if (b.owner !== focus && !isCurrentlyVisible(me, b.x, b.y)) return;
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(6, 16, 10),
      new THREE.MeshStandardMaterial({ color: b.owner === "p1" ? 0xfff2a6 : 0xbaf6ff, emissive: b.owner === "p1" ? 0xffcf33 : 0x36e0ff, emissiveIntensity: 1.4 })
    );
    sphere.position.copy(worldToThree(b.x, b.y, 24));
    scene.add(sphere);
  });

  (state.explosions || []).forEach((e) => {
    // 即使自己死亡也能看到自己的爆炸特效
    const distance = Math.hypot(me.x - e.x, me.y - e.y);
    const visible = distance <= REVEAL_RADIUS || isExplored(state.explored?.[focus], e.x, e.y);
    if (!visible) return;
    
    const radius = Math.max(10, 60 - e.t * 1.2); // 更大的爆炸
    const boom = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 32, 16),
      new THREE.MeshBasicMaterial({ color: 0xff6a1f, transparent: true, opacity: Math.max(.15, e.t / 34) })
    );
    boom.position.copy(worldToThree(e.x, e.y, 40));
    scene.add(boom);
    
    // 额外添加一个更大的白色闪光效果
    const flash = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 1.3, 32, 16),
      new THREE.MeshBasicMaterial({ color: 0xffffaa, transparent: true, opacity: Math.max(.1, e.t / 50) })
    );
    flash.position.copy(worldToThree(e.x, e.y, 45));
    scene.add(flash);
  });

  // 渲染爆炸碎片
  (state.debris || []).forEach((d) => {
    // 即使自己死亡也能看到自己的碎片
    const distance = Math.hypot(me.x - d.x, me.y - d.y);
    const visible = distance <= REVEAL_RADIUS || isExplored(state.explored?.[focus], d.x, d.y);
    if (!visible) return;
    
    const opacity = Math.max(.1, d.t / 100);
    const height = 20 + (100 - d.t) * 0.5; // 碎片稍微升高然后下落
    
    // 随机形状的碎片
    const geometry = Math.random() > 0.5 
      ? new THREE.BoxGeometry(d.size, d.size * 0.6, d.size * 0.8)
      : new THREE.TetrahedronGeometry(d.size * 0.7);
      
    const debrisMesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({ 
        color: d.color, 
        transparent: true, 
        opacity, 
        roughness: 0.5, 
        metalness: 0.5,
        emissive: d.color,
        emissiveIntensity: Math.max(0, d.t / 150) // 发光效果
      })
    );
    debrisMesh.position.copy(worldToThree(d.x, d.y, height));
    debrisMesh.rotation.set(d.rot * 0.5, d.rot, d.rot * 0.3);
    scene.add(debrisMesh);
  });

  // 渲染路人NPC
  (state.pedestrians || []).forEach((ped) => {
    // 检查路人是否可见（包括倒地状态）
    const distance = Math.hypot(me.x - ped.x, me.y - ped.y);
    const visible = distance <= REVEAL_RADIUS || isExplored(state.explored?.[focus], ped.x, ped.y);
    if (!visible) return;
    
    if (ped.alive) {
      // 创建一个站立的小人形状
      const bodyGeom = new THREE.CapsuleGeometry(4, 10, 4, 8);
      const headGeom = new THREE.SphereGeometry(5, 12, 8);
      
      const bodyMat = new THREE.MeshStandardMaterial({ 
        color: ped.color, 
        roughness: 0.7, 
        metalness: 0.1 
      });
      const headMat = new THREE.MeshStandardMaterial({ 
        color: 0xffdbac, 
        roughness: 0.8 
      });
      
      const body = new THREE.Mesh(bodyGeom, bodyMat);
      const head = new THREE.Mesh(headGeom, headMat);
      
      const pedGroup = new THREE.Group();
      pedGroup.add(body);
      pedGroup.add(head);
      
      head.position.y = 10;
      
      // 添加简单的手臂
      const armGeom = new THREE.CapsuleGeometry(2, 6, 4, 6);
      const leftArm = new THREE.Mesh(armGeom, bodyMat);
      const rightArm = new THREE.Mesh(armGeom, bodyMat);
      leftArm.position.set(-5, 5, 0);
      leftArm.rotation.z = Math.PI / 4;
      rightArm.position.set(5, 5, 0);
      rightArm.rotation.z = -Math.PI / 4;
      pedGroup.add(leftArm, rightArm);
      
      // 简单的行走动画 - 手臂摆动
      const armOffset = Math.sin(state.frame * 0.15) * 0.3;
      leftArm.rotation.z = Math.PI / 4 + armOffset;
      rightArm.rotation.z = -Math.PI / 4 - armOffset;
      
      pedGroup.position.copy(worldToThree(ped.x, ped.y, 8));
      pedGroup.rotation.y = -ped.angle + Math.PI / 2;
      
      scene.add(pedGroup);
    } else {
      // 计算透明度（淡出效果）
      const fadeOpacity = Math.min(1, ped.deathTimer / 60); // 最后1秒淡出
      
      // 倒地的路人
      const bodyGeom = new THREE.CapsuleGeometry(4, 10, 4, 8);
      const headGeom = new THREE.SphereGeometry(5, 12, 8);
      
      const bodyMat = new THREE.MeshStandardMaterial({ 
        color: ped.color, 
        roughness: 0.8, 
        metalness: 0.1,
        transparent: true,
        opacity: 0.8 * fadeOpacity
      });
      const headMat = new THREE.MeshStandardMaterial({ 
        color: 0xffdbac, 
        roughness: 0.9,
        transparent: true,
        opacity: 0.8 * fadeOpacity
      });
      
      const body = new THREE.Mesh(bodyGeom, bodyMat);
      const head = new THREE.Mesh(headGeom, headMat);
      
      const pedGroup = new THREE.Group();
      pedGroup.add(body);
      pedGroup.add(head);
      
      head.position.y = 2;
      body.rotation.x = Math.PI / 2;
      
      // 添加倒地的手臂
      const armGeom = new THREE.CapsuleGeometry(2, 6, 4, 6);
      const leftArm = new THREE.Mesh(armGeom, bodyMat);
      const rightArm = new THREE.Mesh(armGeom, bodyMat);
      leftArm.position.set(-6, 2, 2);
      leftArm.rotation.x = Math.PI / 2;
      leftArm.rotation.z = Math.PI / 3;
      rightArm.position.set(6, 2, -2);
      rightArm.rotation.x = Math.PI / 2;
      rightArm.rotation.z = -Math.PI / 3;
      pedGroup.add(leftArm, rightArm);
      
      pedGroup.position.copy(worldToThree(ped.x, ped.y, 3));
      pedGroup.rotation.y = -ped.deathAngle + Math.PI / 2; // 使用固定的死亡角度
      
      scene.add(pedGroup);
      
      // 渲染血迹（带淡出效果，使用固定的大小和位置）
      const bloodGeom = new THREE.CircleGeometry(ped.bloodSize, 16);
      const bloodMat = new THREE.MeshBasicMaterial({ 
        color: 0x8b0000,
        transparent: true,
        opacity: 0.7 * fadeOpacity,
        side: THREE.DoubleSide
      });
      const blood = new THREE.Mesh(bloodGeom, bloodMat);
      blood.rotation.x = -Math.PI / 2;
      blood.position.copy(worldToThree(ped.bloodX, ped.bloodY, 0.5));
      
      // 添加多个小圆点血迹（使用固定数据）
      ped.splatterData.forEach((splatter) => {
        const splatterGeom = new THREE.CircleGeometry(splatter.size, 8);
        const splatterMat = new THREE.MeshBasicMaterial({ 
          color: 0x8b0000,
          transparent: true,
          opacity: 0.5 * fadeOpacity,
          side: THREE.DoubleSide
        });
        const splatterMesh = new THREE.Mesh(splatterGeom, splatterMat);
        splatterMesh.rotation.x = -Math.PI / 2;
        splatterMesh.position.copy(worldToThree(
          ped.bloodX + Math.cos(splatter.angle) * splatter.dist, 
          ped.bloodY + Math.sin(splatter.angle) * splatter.dist, 
          0.6
        ));
        scene.add(splatterMesh);
      });
      
      scene.add(blood);
    }
  });

  const fogRadius = new THREE.Mesh(
    new THREE.CylinderGeometry(REVEAL_RADIUS, REVEAL_RADIUS, 2, 64, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffcf33, transparent: true, opacity: .06, side: THREE.DoubleSide })
  );
  fogRadius.position.copy(worldToThree(me.x, me.y, 2));
  scene.add(fogRadius);

  renderer.render(scene, camera);
  drawHudOverlay(hud, state, focus);
}

function useHoldInput(setInput: React.Dispatch<React.SetStateAction<PlayerInput>>) {
  return useCallback((key: keyof PlayerInput, value: boolean) => {
    setInput((old) => ({ ...old, [key]: value }));
  }, [setInput]);
}

function ControlButton({ label, active, onChange, className = "" }: { label: string; active?: boolean; onChange: (down: boolean) => void; className?: string }) {
  return (
    <button
      className={`select-none rounded-none border-2 border-[#ffcf33] bg-[#16190f]/90 px-5 py-4 font-black text-[#ffcf33] shadow-[5px_5px_0_#000] transition active:translate-x-1 active:translate-y-1 active:shadow-none ${active ? "bg-[#ffcf33] text-black" : ""} ${className}`}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); onChange(true); }}
      onPointerUp={() => onChange(false)}
      onPointerCancel={() => onChange(false)}
      onPointerLeave={() => onChange(false)}
    >
      {label}
    </button>
  );
}

// Three.js 渲染上下文
type ThreeContext = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  hemiLight: THREE.HemisphereLight;
  sunLight: THREE.DirectionalLight;
  ground: THREE.Mesh;
  grid: THREE.GridHelper;
};

export default function Home({ targetSection }: HomeProps) {
  useEffect(() => {
    if (targetSection) document.getElementById(targetSection)?.scrollIntoView({ behavior: "smooth" });
  }, [targetSection]);

  const [role, setRole] = useState<Role>("menu");
  const [roomCode, setRoomCode] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [status, setStatus] = useState("待机：选择主机或加入。");
  const [connected, setConnected] = useState(false);
  const [state, setState] = useState<GameState>(() => freshState());
  const [localInput, setLocalInput] = useState<PlayerInput>(EMPTY_INPUT);
  const [tankStyles, setTankStyles] = useState<Record<PlayerId, TankStyleId>>({ 
    p1: "vanguard", 
    p2: "raptor",
    p3: "atlas",
    p4: "specter" // 修复拼写：spectre -> specter
  });
  const [helpOpen, setHelpOpen] = useState(false);
  const [shakeActive, setShakeActive] = useState(false);
  const [confettiBurst, setConfettiBurst] = useState(0);
  const [musicPlaying, setMusicPlaying] = useState(false);
  const [musicVolume, setMusicVolume] = useState(0.5);
  const [menuOpacity, setMenuOpacity] = useState(0.4); // 60%透明，更透明
  const [demoMode, setDemoMode] = useState(true);
  const [isSinglePlayer, setIsSinglePlayer] = useState(false); // 单机模式：AI作为2P
  const [guestPlayerId, setGuestPlayerId] = useState<PlayerId>("p2"); // 客机的玩家ID
  const [connectedPlayers, setConnectedPlayers] = useState<PlayerId[]>(["p1"]); // 显示在UI上的连接玩家
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hudRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<ThreeContext | null>(null);
  const socketRef = useRef<any>(null);
  // 支持多个玩家的输入（主机用）
  const remoteInputsRef = useRef<Map<PlayerId, PlayerInput>>(new Map());
  const connectedPlayersRef = useRef<PlayerId[]>(["p1"]);
  const localInputRef = useRef<PlayerInput>(EMPTY_INPUT);
  const stateRef = useRef<GameState>(state);
  const roomCodeRef = useRef<string>(""); // 解决闭包问题！
  const fireLockRef = useRef(false);
  const lastHpRef = useRef<number | null>(null);
  const lastEnemyAliveRef = useRef<boolean | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const originalMusicVolumeRef = useRef(0.5);
  const synthRef = useRef<SpeechSynthesis | null>(null);
  const speechInitializedRef = useRef(false);
  const lastPedestriansAliveRef = useRef<Map<string, boolean>>(new Map());
  const menuRef = useRef<HTMLDivElement>(null);

  const playerId: PlayerId = role === "guest" ? guestPlayerId : "p1";
  // 对于敌人，现在有多个敌人，但为了兼容性，我们保持这个变量指向第一个敌人
  const activePlayers: PlayerId[] = Object.keys(state.tanks) as PlayerId[];
  const enemyId: PlayerId = activePlayers.find(id => id !== playerId) ?? "p2";
  const hold = useHoldInput(setLocalInput);

  useEffect(() => { localInputRef.current = localInput; }, [localInput]);
  useEffect(() => { stateRef.current = state; }, [state]);

  // 背景音乐控制 - 使用本地音乐文件
  useEffect(() => {
    const audio = new Audio('/bgmusic.mp3');
    audio.loop = true;
    audio.volume = musicVolume;
    audioRef.current = audio;
    originalMusicVolumeRef.current = musicVolume;
    
    // 初始化语音合成
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      synthRef.current = window.speechSynthesis;
      console.log('🎤 Speech synthesis initialized');
    }
    
    audio.addEventListener('canplay', () => {
      console.log('✅ Local audio loaded successfully');
    });
    
    audio.addEventListener('error', (e) => {
      console.error('❌ Audio error:', e);
    });
    
    return () => {
      audio.pause();
      audioRef.current = null;
      if (synthRef.current) {
        synthRef.current.cancel();
      }
    };
  }, []);
  
  // 初始化lastPedestriansAliveRef
  useEffect(() => {
    const aliveMap = new Map<string, boolean>();
    (state.pedestrians || []).forEach(ped => {
      aliveMap.set(ped.id, ped.alive);
    });
    lastPedestriansAliveRef.current = aliveMap;
  }, []);
  
  // 检测NPC死亡并播放语音
  useEffect(() => {
    if (!synthRef.current || state.phase !== 'playing') return;
    
    // 检查有哪些NPC刚刚死亡（之前活着，现在死了）
    let hasDeath = false;
    (state.pedestrians || []).forEach(ped => {
      const wasAlive = lastPedestriansAliveRef.current.get(ped.id);
      if (wasAlive === true && !ped.alive) {
        hasDeath = true;
        console.log('💀 NPC died:', ped.id); // 调试日志
      }
    });
    
    // 如果有NPC死亡，播放语音
    if (hasDeath) {
      console.log('🔊 About to play death voice...'); // 调试日志
      playDeathVoice(synthRef.current!);
    }
    
    // 更新上一帧的状态
    const newAliveMap = new Map<string, boolean>();
    (state.pedestrians || []).forEach(ped => {
      newAliveMap.set(ped.id, ped.alive);
    });
    lastPedestriansAliveRef.current = newAliveMap;
  }, [state.pedestrians, state.phase]);
  
  // 第一次用户交互时，激活语音合成（浏览器安全策略要求）
  useEffect(() => {
    const initSpeech = () => {
      if (!speechInitializedRef.current && typeof window !== 'undefined' && 'speechSynthesis' in window) {
        console.log('🎤 Activating speech synthesis on user interaction...');
        // 关键：必须在用户交互中调用一次getVoices来激活
        window.speechSynthesis.getVoices();
        // 使用一个非常短的静音语音来激活，但不打断其他音频
        const testUtterance = new SpeechSynthesisUtterance(' ');
        testUtterance.volume = 0;
        testUtterance.rate = 10; // 最快速度
        window.speechSynthesis.speak(testUtterance);
        // 立即取消，只是为了激活
        setTimeout(() => {
          window.speechSynthesis.cancel();
        }, 50);
        speechInitializedRef.current = true;
        console.log('✅ Speech synthesis activated');
      }
    };
    // 添加用户交互监听
    document.addEventListener('click', initSpeech, { once: true });
    document.addEventListener('keydown', initSpeech, { once: true });
    document.addEventListener('touchstart', initSpeech, { once: true });
    
    return () => {
      document.removeEventListener('click', initSpeech);
      document.removeEventListener('keydown', initSpeech);
      document.removeEventListener('touchstart', initSpeech);
    };
  }, []);

  // 游戏状态变化时控制背景音乐播放
  useEffect(() => {
    if (!audioRef.current) return;
    
    if (state.phase === 'playing') {
      // 游戏开始，暂停背景音乐
      console.log('🎮 Game started - pausing music');
      audioRef.current.pause();
    } else {
      // 非游戏状态（菜单、结束、大厅），恢复背景音乐
      console.log('🎮 Game ended/menu - resuming music');
      audioRef.current.volume = originalMusicVolumeRef.current;
      if (musicPlaying) { // 只有在音乐开启时才播放
        audioRef.current.play().catch(() => {});
      }
    }
  }, [state.phase, musicPlaying]);

  // 播放/暂停控制
  useEffect(() => {
    if (!audioRef.current) return;
    
    if (musicPlaying) {
      audioRef.current.volume = musicVolume;
      audioRef.current.play().then(() => {
        console.log('🎵 Local music playing');
      }).catch((e) => {
        console.log("Audio waiting for user interaction:", e);
      });
    } else {
      audioRef.current.pause();
    }
  }, [musicPlaying]);

  // 实时音量控制
  useEffect(() => {
    if (audioRef.current) {
      originalMusicVolumeRef.current = musicVolume;
      // 如果不在游戏中，直接应用音量
      if (state.phase !== 'playing') {
        audioRef.current.volume = musicVolume;
      }
      console.log('🔊 Volume changed:', musicVolume);
    }
  }, [musicVolume, state.phase]);

  // 菜单透明度控制
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpacity(0.4); // 点击外面，恢复60%透明
        setDemoMode(true);
      }
    };

    document.addEventListener("click", handleClickOutside);
    
    return () => {
      document.removeEventListener("click", handleClickOutside);
    };
  }, []);

  // Demo模式 - AI自动演示游戏
  useEffect(() => {
    if (!demoMode || role !== "menu") return;
    
    // 为所有坦克保持当前方向的计时器
    const currentDirs: Record<PlayerId, { up: boolean; down: boolean; left: boolean; right: boolean }> = {
      p1: { up: true, down: false, left: false, right: false },
      p2: { up: false, down: true, left: false, right: false },
      p3: { up: false, down: false, left: true, right: false },
      p4: { up: false, down: false, left: false, right: true }
    };
    const dirTimers: Record<PlayerId, number> = {
      p1: 0,
      p2: 0,
      p3: 0,
      p4: 0
    };
    const changeDirEvery = 60; // 每60帧（约1秒）才考虑改变方向
    
    const demoTick = window.setInterval(() => {
      setState((prev) => {
        const inputs: Record<PlayerId, PlayerInput> = {} as any;
        
        // 确定活跃玩家
        const activePlayers: PlayerId[] = Object.keys(prev.tanks) as PlayerId[];
        
        activePlayers.forEach(playerId => {
          dirTimers[playerId]++;
          
          if (dirTimers[playerId] >= changeDirEvery) {
            dirTimers[playerId] = 0;
            const rand = Math.random();
            if (rand < 0.25) {
              currentDirs[playerId] = { up: true, down: false, left: false, right: false };
            } else if (rand < 0.5) {
              currentDirs[playerId] = { up: false, down: true, left: false, right: false };
            } else if (rand < 0.75) {
              currentDirs[playerId] = { up: false, down: false, left: true, right: false };
            } else {
              currentDirs[playerId] = { up: false, down: false, left: false, right: true };
            }
          }
          
          inputs[playerId] = {
            ...currentDirs[playerId],
            fire: Math.random() > 0.98,
            suicide: false
          };
        });
        
        // 自动开始游戏如果还没开始
        if (prev.phase !== "playing" && Math.random() > 0.995) {
          const newState = freshState(true); // 启用所有4个玩家
          newState.phase = "playing";
          return newState;
        }
        
        return stepGame(prev, inputs);
      });
    }, 1000 / 60);
    
    return () => window.clearInterval(demoTick);
  }, [demoMode, role]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const hud = hudRef.current;
    if (canvas && hud) drawGame3D(canvas, hud, state, playerId, rendererRef, tankStyles);
  }, [state, playerId, tankStyles]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent, down: boolean) => {
      const k = e.key.toLowerCase();
      const controlKeys = ["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", " ", "spacebar", "enter"];
      if (!controlKeys.includes(k) && !controlKeys.includes(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
      if (["w", "arrowup"].includes(k)) hold("up", down);
      if (["s", "arrowdown"].includes(k)) hold("down", down);
      if (["a", "arrowleft"].includes(k)) hold("left", down);
      if (["d", "arrowright"].includes(k)) hold("right", down);
      if ([" ", "spacebar", "enter"].includes(k) || [" ", "Enter"].includes(e.key)) hold("fire", down);
    };
    const kd = (e: KeyboardEvent) => onKey(e, true);
    const ku = (e: KeyboardEvent) => onKey(e, false);
    window.addEventListener("keydown", kd); window.addEventListener("keyup", ku);
    return () => { window.removeEventListener("keydown", kd); window.removeEventListener("keyup", ku); };
  }, [hold]);

  // 单机模式AI控制多个玩家的ref
  const aiDirsRef = useRef<Record<PlayerId, { up: boolean; down: boolean; left: boolean; right: boolean }>>({
    p1: { up: false, down: false, left: false, right: false },
    p2: { up: false, down: false, left: false, right: false },
    p3: { up: false, down: false, left: false, right: false },
    p4: { up: false, down: false, left: false, right: false }
  });
  const aiFrameCountsRef = useRef<Record<PlayerId, number>>({
    p1: 0,
    p2: 0,
    p3: 0,
    p4: 0
  });

  useEffect(() => {
    if (role !== "host" && !isSinglePlayer) return;
    let frameCount = 0;
    const tick = window.setInterval(() => {
      setState((prev) => {
        const inputs: Record<PlayerId, PlayerInput> = {} as any;
        
        // 确定活跃玩家
        let activePlayers: PlayerId[];
        if (isSinglePlayer) {
          activePlayers = ALL_PLAYERS;
        } else {
          // 联机模式：p1 加上所有已连接的客机
          // connectedPlayersRef.current 已经是数组了，直接使用！
          activePlayers = connectedPlayersRef.current;
        }
        
        // 本地玩家使用本地输入
        inputs.p1 = localInputRef.current;
        
        // 如果是单机模式，AI控制所有其他玩家
        if (isSinglePlayer) {
          activePlayers.forEach(playerId => {
            if (playerId === "p1") return; // 第一个玩家是玩家
            aiFrameCountsRef.current[playerId]++;
            
            if (aiFrameCountsRef.current[playerId] >= 60) {
              aiFrameCountsRef.current[playerId] = 0;
              const dirs = ["up", "down", "left", "right"] as const;
              const newDir = dirs[Math.floor(Math.random() * dirs.length)];
              aiDirsRef.current[playerId] = { up: false, down: false, left: false, right: false, [newDir]: true };
            }
            
            inputs[playerId] = {
              ...aiDirsRef.current[playerId],
              fire: Math.random() > 0.98,
              suicide: false
            };
          });
        } else {
          // 联机模式：从 remoteInputsRef 获取所有远程玩家输入
          activePlayers.forEach(playerId => {
            if (playerId === "p1") return; // p1 是本地
            // 如果有远程输入就用，没有就用默认输入
            const remoteInput = remoteInputsRef.current.get(playerId);
            inputs[playerId] = remoteInput || { ...EMPTY_INPUT };
          });
        }
        
        const next = stepGame(prev, inputs);
        
        // 降低状态同步频率，每 4 帧才同步一次（约 15 FPS），平衡流畅度和带宽
        frameCount++;
        if (role === "host" && !isSinglePlayer && frameCount % 4 === 0) {
          // 向所有连接发送游戏状态
          const currentRoomCode = roomCodeRef.current;
          try {
            socketRef.current?.emit('gameState', { roomCode: currentRoomCode, state: next });
          } catch (e) {
            console.error("❌ 发送状态失败:", e);
          }
        }
        
        return next;
      });
    }, 1000 / 60);
    return () => window.clearInterval(tick);
  }, [role, isSinglePlayer]);

  useEffect(() => {
    if (role !== "guest") return;
    const tick = window.setInterval(() => {
      if (socketRef.current?.connected) {
        try {
          socketRef.current.emit('playerInput', { roomCode, playerId: guestPlayerId, input: localInput });
        } catch (e) {
          console.error("发送输入失败:", e);
        }
      }
    }, 1000 / 30); // 30 FPS 的输入更新
    return () => window.clearInterval(tick);
  }, [localInput, role, guestPlayerId, roomCode]);

  useEffect(() => {
    const myHp = state.tanks[playerId]?.hp;
    if (typeof myHp !== "number") return;
    if (lastHpRef.current !== null && myHp < lastHpRef.current && state.phase === "playing") {
      setShakeActive(false);
      window.requestAnimationFrame(() => setShakeActive(true));
    }
    lastHpRef.current = myHp;
  }, [playerId, state.phase, state.tanks]);

  useEffect(() => {
    const enemyAlive = state.tanks[enemyId]?.alive;
    if (typeof enemyAlive !== "boolean") return;
    if (lastEnemyAliveRef.current === true && enemyAlive === false && state.phase === "playing" && state.tanks[playerId]?.alive) {
      setConfettiBurst((n) => n + 1);
    }
    lastEnemyAliveRef.current = enemyAlive;
  }, [enemyId, playerId, state.phase, state.tanks]);

  useEffect(() => {
    if (!confettiBurst) return;
    const timer = window.setTimeout(() => setConfettiBurst(0), 2300);
    return () => window.clearTimeout(timer);
  }, [confettiBurst]);

  useEffect(() => {
    persistMapSeed(state.mapSeed);
  }, [state.mapSeed]);

  const exitSession = useCallback(() => {
    console.log("🚪 退出房间");
    // 断开 socket 连接
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    remoteInputsRef.current.clear();
    connectedPlayersRef.current = ["p1"];
    localInputRef.current = EMPTY_INPUT;
    setLocalInput(EMPTY_INPUT);
    setConnected(false);
    setRoomCode("");
    setJoinCode("");
    setRole("menu");
    setIsSinglePlayer(false);
    setGuestPlayerId("p2"); // 重置客机玩家ID
    setStatus("待机：选择主机或加入。");
    setState(freshState());
    toast("已退出房间");
  }, []);

  const createHost = useCallback(() => {
    console.log("🎯 创建主机...");
    setRole("host");
    setIsSinglePlayer(false);
    setDemoMode(false);
    setStatus("连接服务器中...");
    
    // 连接到 socket.io 服务器
    const socket = io(SERVER_URL);
    socketRef.current = socket;
    
    socket.on('connect', () => {
      console.log("✅ 已连接到服务器");
      socket.emit('createRoom');
    });
    
    socket.on('roomCreated', ({ roomCode: code, playerId }) => {
      console.log("✅ 房间创建成功:", code);
      setRoomCode(code);
      roomCodeRef.current = code; // 更新 ref！
      setConnected(true);
      setStatus("主机已开启，把房间码发给其他玩家。");
      toast.success("房间已创建！");
    });
    
    socket.on('playerListUpdated', ({ players }) => {
      console.log("👥 玩家列表更新:", players);
      // 提取玩家 ID 列表 (p1, p2, p3, p4)
      const newConnectedPlayers = players.map((p: string) => {
        if (p.includes("主机")) return "p1";
        return p.toLowerCase() as PlayerId;
      });
      
      connectedPlayersRef.current = newConnectedPlayers;
      setConnectedPlayers(newConnectedPlayers);
      
      // 初始化所有玩家的默认输入，防止 undefined 问题！
      const allPlayerIds = connectedPlayersRef.current;
      allPlayerIds.forEach(playerId => {
        if (playerId !== "p1" && !remoteInputsRef.current.has(playerId)) {
          console.log("🎮 初始化玩家输入:", playerId);
          remoteInputsRef.current.set(playerId, { ...EMPTY_INPUT });
        }
      });
      
      setStatus(`${players.join("、")} 已接入，按“开战”开始。`);
      
      // 更新状态
      const enableAllPlayers = connectedPlayersRef.current.length >= 2;
      setState((prev) => {
        if (prev.phase === "playing") {
          return prev;
        }
        return freshState(enableAllPlayers);
      });
    });
    
    socket.on('remotePlayerInput', ({ playerId: pid, input }) => {
      remoteInputsRef.current.set(pid, input);
    });
    
    socket.on('playerLeft', ({ playerId, players }) => {
      console.log("👋 玩家离开:", playerId);
      remoteInputsRef.current.delete(playerId);
      
      const newConnectedPlayers = players.map((p: string) => {
        if (p.includes("主机")) return "p1";
        return p.toLowerCase() as PlayerId;
      });
      
      connectedPlayersRef.current = newConnectedPlayers;
      setConnectedPlayers(newConnectedPlayers);
      
      const enableAllPlayers = connectedPlayersRef.current.length >= 2;
      setStatus(`${players.join("、")} 已接入，按“开战”开始。`);
      toast.warning(`玩家 ${playerId.toUpperCase()} 已离开`);
      
      // 更新状态
      setState((prev) => {
        if (prev.phase === "playing") {
          return prev;
        }
        return freshState(enableAllPlayers);
      });
    });
    
    socket.on('hostLeft', () => {
      console.log("⚠️ 主机离开");
      toast.error("主机已离开");
      exitSession();
    });
    
    socket.on('disconnect', () => {
      console.log("🔌 与服务器断开连接");
    });
    
    socket.on('error', (err) => {
      console.error("❌ Socket 错误:", err);
      toast.error("连接服务器失败");
    });
  }, [exitSession]);

  const joinHost = useCallback(() => {
    if (!joinCode.trim()) {
      toast.error("请输入房间码");
      return;
    }
    
    console.log("🔗 加入房间:", joinCode);
    setStatus("连接服务器中...");
    
    const socket = io(SERVER_URL);
    socketRef.current = socket;
    
    socket.on('connect', () => {
      console.log("✅ 已连接到服务器");
      socket.emit('joinRoom', joinCode.trim().toUpperCase());
      setRole("guest");
      setDemoMode(false);
      setIsSinglePlayer(false);
    });
    
    socket.on('joinedRoom', ({ roomCode: code, playerId }) => {
      console.log("✅ 成功加入房间，分配玩家ID:", playerId);
      setRoomCode(code);
      setGuestPlayerId(playerId);
      setConnected(true);
      setStatus("已接入主机，等待主机开战。");
      toast.success(`成功加入！你是玩家 ${playerId.toUpperCase()}`);
    });
    
    socket.on('roomNotFound', () => {
      toast.error("房间不存在");
      socket.disconnect();
    });
    
    socket.on('roomFull', () => {
      toast.error("房间已满");
      socket.disconnect();
    });
    
    socket.on('roomAlreadyStarted', () => {
      toast.error("游戏已开始");
      socket.disconnect();
    });
    
    socket.on('gameStarted', () => {
      // 不要在这里修改 state，而是等待 gameStateUpdated 事件！
    });
    
    socket.on('gameStateUpdated', (newState) => {
      try {
        setState(newState);
      } catch (e) {
        console.error("❌ 应用游戏状态失败:", e);
      }
    });
    
    socket.on('gameRestarted', () => {
      setState((prev) => {
        const newState = freshState(connectedPlayersRef.current.length >= 2);
        newState.phase = "playing";
        return newState;
      });
    });
    
    socket.on('playerListUpdated', ({ players }) => {
      console.log("👥 玩家列表更新:", players);
      // 提取玩家 ID 列表 (p1, p2, p3, p4)
      const newConnectedPlayers = players.map((p: string) => {
        if (p.includes("主机")) return "p1";
        return p.toLowerCase() as PlayerId;
      });
      
      connectedPlayersRef.current = newConnectedPlayers;
      setConnectedPlayers(newConnectedPlayers);
      
      setStatus(`${players.join("、")} 已接入，等待主机开战。`);
    });
    
    socket.on('playerLeft', ({ playerId, players }) => {
      console.log("👋 玩家离开:", playerId);
      
      // 提取玩家 ID 列表
      const newConnectedPlayers = players.map((p: string) => {
        if (p.includes("主机")) return "p1";
        return p.toLowerCase() as PlayerId;
      });
      
      connectedPlayersRef.current = newConnectedPlayers;
      setConnectedPlayers(newConnectedPlayers);
      
      setStatus(`${players.join("、")} 已接入，等待主机开战。`);
      toast.warning(`玩家 ${playerId.toUpperCase()} 已离开`);
    });
    
    socket.on('hostLeft', () => {
      console.log("⚠️ 主机离开");
      toast.error("主机已离开");
      exitSession();
    });
    
    socket.on('disconnect', () => {
      console.log("🔌 与服务器断开连接");
    });
    
    socket.on('error', (err) => {
      console.error("❌ Socket 错误:", err);
      toast.error("连接服务器失败");
    });
  }, [joinCode, exitSession]);

  const startGame = useCallback(() => {
    if (role !== "host") return;
    
    // 直接使用连接玩家数组给 freshState
    const activePlayers = connectedPlayersRef.current;
    
    // 先创建初始 state
    const initialState = freshState(activePlayers);
    initialState.phase = "playing";
    
    // 立即向所有客机发送这个初始 state
    const currentRoomCode = roomCodeRef.current;
    try {
      socketRef.current?.emit('gameState', { roomCode: currentRoomCode, state: initialState });
    } catch (e) {
      console.error("❌ 发送初始状态失败:", e);
    }
    
    // 然后本地设置 state
    setState(initialState);
    
    // 通知服务器开始游戏
    socketRef.current?.emit('startGame', currentRoomCode);
  }, [role]);

  const startSinglePlayer = () => {
    setIsSinglePlayer(true);
    setDemoMode(false);
    setRole("host"); // 单机模式也用host逻辑
    setStatus("单机模式：开始对战AI！");
    const ns = freshState(true); // 启用所有4个玩家
    ns.phase = "playing";
    persistMapSeed(ns.mapSeed);
    setState(ns);
  };

  const restart = () => {
    if (role === "host") {
      if (isSinglePlayer) {
        const ns = freshState(true);
        ns.phase = "playing";
        setState(ns);
      } else {
        socketRef.current?.emit('restartGame', roomCode);
        const enableAllPlayers = connectedPlayersRef.current.length >= 2;
        setState((prev) => {
          const newState = freshState(enableAllPlayers);
          newState.phase = "playing";
          return newState;
        });
      }
    } else {
      // 客机：不发送重启请求，让主机控制
      toast.info("请等待主机重新开始游戏");
    }
  };

  const copyRoomCode = useCallback(async () => {
    if (!roomCode) return;
    await navigator.clipboard?.writeText(roomCode);
    toast.success("房间码已复制");
  }, [roomCode]);

  const menuVisible = role === "menu" || state.phase !== "playing";
  const showExit = role !== "menu";
  // 安全获取 myTank 和 enemyTank，避免 state.tanks 没有对应键的情况
  const myTank = state.tanks[playerId] || {
    id: playerId,
    hp: 5,
    score: 0,
    alive: true,
    x: 0,
    y: 0,
    angle: 0,
    cooldown: 0,
    crashCooldown: 0,
    color: "#ffcf33",
    respawn: 0,
    deathTime: 0
  };
  // 找到第一个活着的敌人坦克
  const activePlayerIds = Object.keys(state.tanks) as PlayerId[];
  const firstEnemyId = activePlayerIds.find(id => id !== playerId) || playerId;
  const enemyTank = state.tanks[firstEnemyId] || {
    id: firstEnemyId,
    hp: 5,
    score: 0,
    alive: true,
    x: 0,
    y: 0,
    angle: 0,
    cooldown: 0,
    crashCooldown: 0,
    color: "#36e0ff",
    respawn: 0,
    deathTime: 0
  };
  const refreshCountdownActive = state.phase === "playing" && state.refreshTimer > 0 && state.refreshTimer <= MAP_REFRESH_WARNING_TICKS;
  const refreshSeconds = Math.ceil(state.refreshTimer / 60);
  const refreshFlash = state.refreshTimer % 24 < 12;
  const cornerRefreshVisible = state.phase === "playing" && state.refreshTimer > MAP_REFRESH_WARNING_TICKS;
  const cornerRefreshSeconds = Math.ceil(state.refreshTimer / 60);
  const respawnSeconds = Math.ceil((myTank?.respawn || 0) / 60);
  const confettiPieces = useMemo(
    () => Array.from({ length: 96 }, (_, i) => {
      const lane = i % 6;
      const row = Math.floor(i / 6);
      const startXs = ["8%", "24%", "40%", "60%", "76%", "92%"];
      const startYs = ["18%", "30%", "42%", "54%"];
      const spreadX = [-320, -230, -120, 120, 230, 320][lane] + (row % 3) * 18;
      const spreadY = 180 + (row % 5) * 56;
      return {
        id: `${confettiBurst}-${i}`,
        color: ["#ffcf33", "#36e0ff", "#ff6b4a", "#69f0ae", "#ffd166", "#b197fc", "#ffffff", "#ff8a55"][i % 8],
        startX: startXs[lane],
        startY: startYs[row % 4],
        dx: `${spreadX + Math.sin(i * 1.7) * 110}px`,
        dy: `${spreadY + Math.cos(i * 0.9) * 140}px`,
        rot: `${(i % 2 ? 1 : -1) * (300 + i * 18)}deg`,
        delay: `${(i % 12) * 18}ms`,
        sizeW: `${10 + (i % 4) * 4}px`,
        sizeH: `${18 + (i % 5) * 6}px`,
      };
    }),
    [confettiBurst],
  );
  const connectionText = useMemo(() => connected ? "链路在线" : role === "menu" ? "未连接" : "等待连接", [connected, role]);

  return (
    <main className="min-h-screen overflow-hidden bg-[#080907] text-[#f6f0d0]">
      <div className="pointer-events-none fixed inset-0 opacity-40 [background-image:linear-gradient(rgba(255,207,51,.07)_1px,transparent_1px),linear-gradient(90deg,rgba(255,207,51,.05)_1px,transparent_1px)] [background-size:22px_22px]" />
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(255,207,51,.18),transparent_34%),radial-gradient(circle_at_85%_70%,rgba(54,224,255,.13),transparent_28%)]" />

      <section className="relative mx-auto flex min-h-screen max-w-7xl flex-col gap-3 p-3 lg:p-5">
        <motion.section initial={{ y: 35, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: .08 }} className="flex min-h-0 flex-1 flex-col gap-3">
          <div className={`relative border-2 border-[#d09a2b] bg-black p-2 shadow-[12px_12px_0_#000] ${shakeActive ? "screen-shake" : ""}`} onAnimationEnd={() => setShakeActive(false)}>
            <canvas ref={canvasRef} width={W} height={H} className="aspect-video w-full bg-black" />
            <canvas ref={hudRef} width={W} height={H} className="pointer-events-none absolute inset-2 aspect-video w-[calc(100%-1rem)]" />

            <div className="absolute inset-x-3 top-3 flex items-start justify-between gap-3 sm:inset-x-5 sm:top-5 z-20">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setHelpOpen(true)}
                  className="flex items-center gap-2 border-2 border-[#36e0ff] bg-[#091019]/88 px-3 py-2 text-sm font-black text-[#baf6ff] shadow-[4px_4px_0_#000] backdrop-blur transition hover:bg-[#0f1b28]"
                >
                  <CircleHelp className="h-4 w-4" />帮助
                </button>
              </div>
              <div className="flex items-center gap-2">
                {showExit && (
                  <button
                    onClick={exitSession}
                    className="flex items-center gap-2 border-2 border-[#ff6b4a] bg-[#1a0d09]/88 px-3 py-2 text-sm font-black text-[#ffd8c8] shadow-[4px_4px_0_#000] backdrop-blur transition hover:bg-[#29120c]"
                  >
                    <LogOut className="h-4 w-4" />退出
                  </button>
                )}
              </div>
            </div>

            <AnimatePresence>
              {menuVisible && (
                <motion.div 
                  initial={{ opacity: 0, scale: .96 }} 
                  animate={{ opacity: 1, scale: 1 }} 
                  exit={{ opacity: 0, scale: .98 }} 
                  transition={{ duration: 0.3 }}
                  className="fixed inset-0 z-10 flex items-center justify-center bg-black/30 p-3 sm:p-5"
                >
                  <div 
                    ref={menuRef}
                    style={{ opacity: menuOpacity }}
                    className="max-h-[calc(100vh-2rem)] w-[min(92vw,560px)] overflow-y-auto border-2 border-[#ffcf33] bg-[#11150d] p-4 shadow-[10px_10px_0_#000] sm:max-h-[calc(100vh-3rem)] sm:p-5 transition-opacity duration-300"
                    onMouseEnter={() => { setMenuOpacity(1); setDemoMode(false); }}
                    onMouseMove={() => { setMenuOpacity(1); setDemoMode(false); }}
                    onMouseLeave={() => { setMenuOpacity(0.4); setDemoMode(true); }}
                    onTouchStart={() => { setMenuOpacity(1); setDemoMode(false); }}
                    onClick={(e) => { 
                      e.stopPropagation(); // 阻止事件冒泡到背景层
                      setMenuOpacity(1); 
                      setDemoMode(false);
                      // 用户点击时播放音乐
                      if (audioRef.current && musicPlaying) {
                        audioRef.current.play().catch(err => console.log("Audio play:", err));
                      }
                    }}
                  >
                    <div className="mb-4 flex items-start justify-between gap-3">
                      <div>
                        <Badge className="rounded-none bg-[#ffcf33] text-black">MULTIPLAYER TANK</Badge>
                        <h1 className="mt-3 text-3xl font-black leading-none tracking-tight text-[#ffcf33] sm:text-4xl">多人坦克大战</h1>
                      </div>
                      <div className="flex items-center gap-2">
                        {/* 音乐开关按钮 */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setMusicPlaying(!musicPlaying);
                          }}
                          className="flex items-center justify-center border-2 border-[#ffcf33] bg-[#11150d] p-2 text-[#ffcf33] transition hover:bg-[#ffcf33] hover:text-black"
                          title={musicPlaying ? "关闭音乐" : "开启音乐"}
                        >
                          {musicPlaying ? (
                            <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071a1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414zm-2.829 2.828a1 1 0 011.415 0A5.983 5.983 0 0115 10a5.984 5.984 0 01-1.757 4.243a1 1 0 01-1.415-1.415A3.984 3.984 0 0013 10a3.983 3.983 0 00-1.172-2.828a1 1 0 010-1.415z" clipRule="evenodd" />
                            </svg>
                          ) : (
                            <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v10c0 .891-1.077 1.337-1.707.707L5.586 15z" clipRule="evenodd" />
                            </svg>
                          )}
                        </button>
                        <Swords className="mt-1 h-9 w-9 shrink-0 text-[#36e0ff]" />
                      </div>
                    </div>

                    <div className="mb-4 grid grid-cols-2 gap-2 text-sm">
                      <div className="border border-[#ffcf33]/35 p-3"><Shield className="mb-1 h-4 w-4 text-[#ffcf33]" />你：{myTank.hp} HP / {myTank.score} 分</div>
                      <div className="border border-[#36e0ff]/35 p-3"><Crosshair className="mb-1 h-4 w-4 text-[#36e0ff]" />敌：{enemyTank.hp} HP / {enemyTank.score} 分</div>
                    </div>

                    {(role !== "menu" || isSinglePlayer) && (
                      <Card className="mb-4 rounded-none border-[#ffcf33]/50 bg-black/35 p-3 text-[#f6f0d0]">
                        <div className="flex items-center justify-between"><span className="text-xs text-[#d8d2ad]">身份</span><b>{isSinglePlayer ? "1P 单机" : (role === "host" ? "1P 主机" : "2P 客机")}</b></div>
                        {!isSinglePlayer && (
                          <div className="mt-2 flex items-center justify-between"><span className="text-xs text-[#d8d2ad]">状态</span><b className={connected ? "text-[#73ff8f]" : "text-[#ffcf33]"}>{connectionText}</b></div>
                        )}
                        {role === "host" && !isSinglePlayer && (
                          <div className="mt-3 border border-dashed border-[#ffcf33]/40 p-3 text-center">
                            <div className="text-xs text-[#d8d2ad]">房间码</div>
                            <button onClick={copyRoomCode} className="mt-1 text-3xl font-black tracking-wider text-[#ffcf33]">{roomCode}</button>
                            <button onClick={copyRoomCode} className="mx-auto mt-2 flex items-center gap-2 border border-[#ffcf33]/35 px-2 py-1 text-xs text-[#f6f0d0]">
                              <Copy className="h-3.5 w-3.5" />复制房间码
                            </button>
                          </div>
                        )}
                        <p className="mt-3 text-xs leading-5 text-[#d8d2ad]">{status}</p>
                      </Card>
                    )}

                    <div className="mb-4 space-y-3">
                      <Button
                        onClick={(e) => { if (role !== "menu") return; e.currentTarget.blur(); startSinglePlayer(); }}
                        disabled={role !== "menu"}
                        className={`w-full rounded-none py-6 font-black ${role === "menu" ? "bg-[#73ff8f] text-black hover:bg-[#a0ffbd]" : "bg-[#545454] text-[#c8c8c8] opacity-90"}`}
                      >
                        <Gamepad2 className="mr-2" />单机模式 / AI对战
                      </Button>
                      <Button
                        onClick={(e) => { if (role !== "menu") return; e.currentTarget.blur(); createHost(); }}
                        disabled={role !== "menu"}
                        className={`w-full rounded-none py-6 font-black ${role === "menu" ? "bg-[#ffcf33] text-black hover:bg-[#ffe46e]" : "bg-[#545454] text-[#c8c8c8] opacity-90"}`}
                      >
                        <RadioTower className="mr-2" />开主机 / 1P
                      </Button>
                      {role === "menu" ? (
                        <div className="grid grid-cols-[1fr_auto] gap-2">
                          <Input value={joinCode} onChange={(e) => setJoinCode(e.target.value)} placeholder="输入房间码，如 TANK-ABCD" className="rounded-none border-[#36e0ff] bg-black/50 uppercase text-[#36e0ff]" />
                          <Button onClick={(e) => { e.currentTarget.blur(); joinHost(); }} className="rounded-none bg-[#36e0ff] font-black text-black hover:bg-[#88f0ff]">加入</Button>
                        </div>
                      ) : (
                        <button onClick={exitSession} className="w-full rounded-none border-2 border-[#ff6b4a] bg-[#1a0d09] py-4 text-sm font-black text-[#ffd8c8] shadow-[5px_5px_0_#000] transition hover:bg-[#29120c]">
                          退出房间
                        </button>
                      )}
                    </div>

                    <div className="mb-4 border-2 border-[#36e0ff]/45 bg-black/25 p-3">
                      <div className="mb-3 flex items-center gap-2 text-sm font-black text-[#36e0ff]"><Palette className="h-4 w-4" />坦克造型</div>
                      <div className="grid grid-cols-2 gap-2">
                        {STYLE_IDS.map((id) => {
                          const style = TANK_STYLES[id];
                          const active = tankStyles[playerId] === id;
                          return (
                            <button
                              key={id}
                              onClick={(e) => { e.currentTarget.blur(); setTankStyles((old) => ({ ...old, [playerId]: id })); }}
                              className={`rounded-none border-2 p-2 text-left transition active:translate-x-1 active:translate-y-1 ${active ? "border-white bg-white/15 shadow-[4px_4px_0_#000]" : "border-[#ffcf33]/30 bg-[#11150d]/70"}`}
                            >
                              <div className="mb-1 flex gap-1">
                                <span className="h-3 w-8 border border-white/30" style={{ background: style.primary }} />
                                <span className="h-3 w-5 border border-white/30" style={{ background: style.secondary }} />
                              </div>
                              <div className="text-xs font-black text-[#f6f0d0]">{style.name}</div>
                              <div className="text-[10px] leading-4 text-[#d8d2ad]">{style.desc}</div>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* 玩家列表 */}
                    {(role === "host" || role === "guest") && (
                      <div className="mb-4 border-2 border-[#ffcf33]/45 bg-black/25 p-3">
                        <div className="mb-3 flex items-center gap-2 text-sm font-black text-[#ffcf33]"><Gamepad2 className="h-4 w-4" />玩家列表</div>
                        <div className="space-y-2">
                          {ALL_PLAYERS.map((pid) => {
                            const isConnected = connectedPlayers.includes(pid);
                            const isHost = pid === "p1";
                            const color = PLAYER_COLORS[pid];
                            const displayId = pid.toUpperCase();
                            
                            return (
                              <div 
                                key={pid} 
                                className={`flex items-center gap-3 border-2 p-2 transition ${isConnected ? "border-white/30 bg-white/10" : "border-white/10 bg-white/5 opacity-50"}`}
                              >
                                {/* 坦克颜色预览 */}
                                <div className="flex gap-1">
                                  <span className="h-4 w-6 border border-white/30" style={{ background: color }} />
                                  <span className="h-4 w-3 border border-white/30" style={{ background: color, filter: 'brightness(0.6)' }} />
                                </div>
                                
                                {/* 玩家ID和状态 */}
                                <div className="flex-1">
                                  <div className="text-xs font-black text-[#f6f0d0]">
                                    {displayId} {isHost ? "(主机)" : ""}
                                  </div>
                                  <div className={`text-[10px] leading-4 ${isConnected ? "text-[#73ff8f]" : "text-[#888]"}`}>
                                    {isConnected ? "已连接" : "等待中..."}
                                  </div>
                                </div>
                                
                                {/* 连接状态指示器 */}
                                <div className={`h-3 w-3 rounded-full ${isConnected ? "bg-[#73ff8f] shadow-[0_0_8px_rgba(115,255,143,0.8)]" : "bg-[#545454]"}`} />
                              </div>
                            );
                          })}
                        </div>
                        <div className="mt-2 text-[10px] text-[#d8d2ad]/70">
                          最多支持 4 人同时联机
                        </div>
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2">
                      {(role === "host" || isSinglePlayer) && (
                        <Button 
                          onClick={(e) => { e.currentTarget.blur(); startGame(); }} 
                          disabled={!connected && !isSinglePlayer && state.phase !== "playing"} 
                          className="flex-1 rounded-none bg-[#ff6422] py-6 font-black text-black hover:bg-[#ff8a55]"><Zap className="mr-2" />开战 / 重开</Button>
                      )}
                      {state.phase === "ended" && <Button onClick={(e) => { e.currentTarget.blur(); restart(); }} className="flex-1 rounded-none bg-[#36e0ff] py-6 font-black text-black">再来一局</Button>}
                      {(role !== "menu" || isSinglePlayer) && state.phase === "lobby" && (
                        <button onClick={() => setHelpOpen(true)} className="rounded-none border-2 border-[#ffcf33]/40 px-4 py-3 text-sm font-black text-[#f6f0d0]">先看帮助</button>
                      )}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {helpOpen && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-20 flex items-center justify-center bg-black/64 p-3 backdrop-blur-[3px] sm:p-5">
                  <motion.div initial={{ y: 16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 10, opacity: 0 }} className="max-h-[calc(100vh-2rem)] w-[min(92vw,520px)] overflow-y-auto border-2 border-[#36e0ff] bg-[#0d1215]/96 p-5 shadow-[10px_10px_0_#000] sm:max-h-[calc(100vh-3rem)]">
                    <div className="mb-4 flex items-start justify-between gap-4">
                      <div>
                        <div className="text-xs font-black tracking-[0.24em] text-[#36e0ff]">HELP / 操作说明</div>
                        <h2 className="mt-2 text-2xl font-black text-[#f6f0d0]">怎么玩</h2>
                      </div>
                      <button onClick={() => setHelpOpen(false)} className="border border-white/20 p-2 text-[#d8d2ad] transition hover:bg-white/10"><X className="h-4 w-4" /></button>
                    </div>
                    <div className="space-y-3 text-sm leading-6 text-[#d8d2ad]">
                      <p>1P 点 <b className="text-[#ffcf33]">开主机</b>，把房间码发给 2P；2P 输入房间码后加入。</p>
                      <p>移动端用下方方向键和开火按钮；键盘也支持 <b className="text-[#ffcf33]">WASD / 方向键 / 空格</b>。</p>
                      <p>主画面是坦克正后上方的 3D 跟随视角；小地图只显示你探索过的区域，不暴露敌人坐标。</p>
                      <p>右上角 <b className="text-[#ff6b4a]">退出</b> 会断开房间并回到主菜单，不会卡在当前对局里。</p>
                    </div>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {refreshCountdownActive && (
                <motion.div key={`refresh-${refreshSeconds}-${refreshFlash ? 'a' : 'b'}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className={`pointer-events-none absolute inset-0 z-[6] flex flex-col items-center justify-center ${refreshFlash ? 'bg-[#ffcf33]/18' : 'bg-[#ff6b4a]/20'}`}>
                  <div className="border-4 border-[#ffcf33] bg-black/72 px-8 py-6 text-center shadow-[12px_12px_0_#000] backdrop-blur-[2px]">
                    <div className="text-sm font-black tracking-[0.34em] text-[#ffcf33]">MAP REFRESH</div>
                    <div
                      className="mt-3 text-7xl font-black leading-none text-[#fff2a6] sm:text-8xl"
                      style={{ WebkitTextStroke: '3px #ffcf33', textShadow: '0 0 0 #ffcf33, 0 0 14px rgba(255,207,51,.75), 0 0 34px rgba(255,184,61,.48), 5px 5px 0 rgba(82,42,8,.95)' }}
                    >
                      {refreshSeconds}
                    </div>
                    <div className="mt-3 border border-[#ffcf33]/35 bg-black/18 px-3 py-2 text-sm text-[#f6f0d0]">5 秒后战场重构：障碍与双方位置将全部随机刷新</div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {confettiBurst > 0 && enemyTank && !enemyTank.alive && myTank.alive && state.phase === "playing" && (
                <motion.div key={confettiBurst} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pointer-events-none absolute inset-0 z-[8] overflow-hidden">
                  <div className="confetti-glow absolute inset-0 bg-[radial-gradient(circle_at_50%_30%,rgba(255,207,51,.24),transparent_34%),radial-gradient(circle_at_15%_20%,rgba(54,224,255,.18),transparent_24%),radial-gradient(circle_at_85%_18%,rgba(255,107,74,.18),transparent_24%),radial-gradient(circle_at_50%_100%,rgba(105,240,174,.18),transparent_30%)]" />
                  <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,.08),transparent_22%,transparent_78%,rgba(255,255,255,.05))]" />
                  {confettiPieces.map((piece) => (
                    <span
                      key={piece.id}
                      className="confetti-piece"
                      style={{ background: piece.color, ['--dx' as string]: piece.dx, ['--dy' as string]: piece.dy, ['--rot' as string]: piece.rot, ['--startX' as string]: piece.startX, ['--startY' as string]: piece.startY, ['--sizeW' as string]: piece.sizeW, ['--sizeH' as string]: piece.sizeH, animationDelay: piece.delay, boxShadow: `0 0 14px ${piece.color}` }}
                    />
                  ))}
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
                    <div
                      className="victory-pulse victory-punch text-center text-6xl font-black leading-none text-[#ffcf33] drop-shadow-[0_0_22px_rgba(255,207,51,.62)] sm:text-8xl"
                      style={{ WebkitTextStroke: '3px #fff1a6', textShadow: '0 0 0 #fff1a6, 0 0 18px rgba(255,207,51,.78), 0 0 42px rgba(255,184,61,.55), 4px 4px 0 rgba(84,48,8,.95)' }}
                    >
                      VICTORY!
                    </div>
                    <div className="text-center text-sm font-black tracking-[0.45em] text-white/85 sm:text-base">FULL SCREEN CELEBRATION</div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {!myTank.alive && myTank.respawn > 0 && state.phase === "playing" && (state.frame - myTank.deathTime) > 30 && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-[7] grid place-items-center">
                  <div className="respawn-pulse text-center">
                    <div className="text-sm font-black tracking-[0.34em] text-[#ffcf33]">RESPAWN</div>
                    <div
                      className="arcade-number mt-3 text-7xl font-black leading-none text-[#fff2a6] sm:text-8xl"
                      style={{ WebkitTextStroke: '3px #ffcf33', textShadow: '0 0 0 #ffcf33, 0 0 14px rgba(255,207,51,.75), 0 0 34px rgba(255,184,61,.48), 5px 5px 0 rgba(82,42,8,.95)' }}
                    >
                      {respawnSeconds}
                    </div>
                    <div className="mt-3 px-3 py-2 text-sm text-[#f3cabd]">你已被击毁，5 秒后将在地图随机位置重生</div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {cornerRefreshVisible && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} className="pointer-events-none absolute bottom-4 right-4 z-[5]">
                  <div className="relative min-w-[180px] px-3 py-2 text-right">
                    <div className="text-[10px] font-black tracking-[0.28em] text-[#ffcf33]/80">MAP REFRESH</div>
                    <div className="relative text-3xl font-black leading-none text-[#fff2a6]" style={{ WebkitTextStroke: '2px #ffcf33', textShadow: '0 0 0 #ffcf33, 0 0 8px rgba(255,207,51,.5)' }}>{cornerRefreshSeconds}</div>
                    <div className="text-xs text-[#f6f0d0]/70">{cornerRefreshSeconds} 秒后刷新战场</div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-4">
            {/* 音乐控制 */}
            <div className="flex items-center gap-2 border-2 border-[#ffcf33] bg-[#11150d]/90 px-3 py-2 shadow-[4px_4px_0_#000]">
              <button
                onClick={() => setMusicPlaying(!musicPlaying)}
                className="flex items-center gap-1 text-[#ffcf33] transition hover:scale-110"
              >
                {musicPlaying ? "🔊" : "🔇"}
                <span className="text-xs font-black">{musicPlaying ? "开" : "关"}</span>
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={musicVolume}
                onChange={(e) => setMusicVolume(parseFloat(e.target.value))}
                className="w-14 h-1.5 bg-[#363636] rounded-lg appearance-none cursor-pointer"
              />
            </div>

            {/* 方向键 */}
            <div className="grid grid-cols-3 gap-1.5">
              <div />
              <ControlButton label="▲" active={localInput.up} onChange={(v) => hold("up", v)} />
              <div />
              <ControlButton label="◀" active={localInput.left} onChange={(v) => hold("left", v)} />
              <div className="flex items-center justify-center">
                <div className="w-10 h-10 rounded-full border-2 border-[#ffcf33]/50 bg-[#11150d]/50" />
              </div>
              <ControlButton label="▶" active={localInput.right} onChange={(v) => hold("right", v)} />
              <div />
              <ControlButton label="▼" active={localInput.down} onChange={(v) => hold("down", v)} />
              <div />
            </div>

            {/* 开火按钮 */}
            <button
              className={`select-none border-4 border-[#ff6422] bg-[#2a1209] text-2xl font-black text-[#ff6422] shadow-[10px_10px_0_#000] transition active:translate-x-1 active:translate-y-1 active:shadow-none ${localInput.fire ? "bg-[#ff6422] text-black" : ""} min-w-[120px] min-h-[70px] px-6 py-4`}
              onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); if (!fireLockRef.current) { fireLockRef.current = true; hold("fire", true); } }}
              onPointerUp={() => { fireLockRef.current = false; hold("fire", false); }}
              onPointerCancel={() => { fireLockRef.current = false; hold("fire", false); }}
            >开火</button>
            
            {/* 自爆按钮 */}
            <button
              className="select-none border-4 border-[#ff3366] bg-[#2a0915] text-xl font-black text-[#ff3366] shadow-[10px_10px_0_#000] transition active:translate-x-1 active:translate-y-1 active:shadow-none min-w-[100px] min-h-[60px] px-4 py-3"
              onClick={() => { if (state.phase === "playing" && state.tanks[playerId].alive) { hold("suicide", true); setTimeout(() => hold("suicide", false), 100); } }}
            >自爆</button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border border-[#ffcf33]/25 bg-[#11150d]/70 px-3 py-2 text-xs text-[#d8d2ad]">
            <span>主画面：正后方俯视3D</span><span>小地图：只显示已探索地形</span><span>敌人：进入视野才显示</span><span>触控：方向键 + 开火</span>
          </div>
        </motion.section>
      </section>
    </main>
  );
}
