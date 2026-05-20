/*
设计承诺：街机军械库 / Brutalist HUD
- 高对比煤黑 + 警戒黄 + 炮火橙，形成战场警报感
- 破格斜切面板、扫描线、像素网格贯穿所有界面
- 触控按钮要像实体军械开关，反馈明显而不是轻微
- 游戏区保持横屏优先，但竖屏也能操作
*/

// ============== PeerJS 网络配置 ==============
// 切换下方的 USE_LOCAL_SERVER 来选择使用哪个信令服务器
const USE_LOCAL_SERVER = false; // 改为 true 来使用本地信令服务器

const PEER_CONFIG = USE_LOCAL_SERVER ? {
  // 本地信令服务器配置（需要先运行 npm run signal）
  host: window.location.hostname, // 或者你的内网 IP，比如 '192.168.1.100'
  port: 9000,
  path: '/peerjs/myapp',
  secure: false,
  config: {
    iceServers: [] // 纯内网不需要 STUN 服务器
  }
} : {
  // 公共信令服务器配置（Google STUN）
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
    ]
  }
};
// ===========================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Peer from "peerjs";
import * as THREE from "three";
import type { DataConnection } from "peerjs";
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

type PlayerId = "p1" | "p2";
type Role = "menu" | "host" | "guest";
type Phase = "lobby" | "playing" | "ended";
type Message =
  | { type: "join" }
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

function freshState(): GameState {
  const mapSeed = getInitialMapSeed();
  const walls = generateWalls(mapSeed);
  const p1 = randomSpawn(walls);
  const p2 = randomSpawn(walls, { x: p1.x, y: p1.y });
  return {
    phase: "lobby",
    frame: 0,
    mapSeed,
    refreshTimer: MAP_REFRESH_TICKS,
    bullets: [],
    explosions: [],
    debris: [],
    pedestrians: generatePedestrians(walls, mapSeed),
    tanks: {
      p1: { id: "p1", x: p1.x, y: p1.y, angle: p1.a, hp: 5, cooldown: 0, crashCooldown: 0, score: 0, color: "#ffcf33", alive: true, respawn: 0, deathTime: 0 },
      p2: { id: "p2", x: p2.x, y: p2.y, angle: p2.a, hp: 5, cooldown: 0, crashCooldown: 0, score: 0, color: "#36e0ff", alive: true, respawn: 0, deathTime: 0 },
    },
    explored: { p1: Array(FOG_COUNT).fill(false), p2: Array(FOG_COUNT).fill(false) },
    lastSeenEnemy: { p1: 0, p2: 0 },
    showingHint: { p1: false, p2: false },
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
function refreshBattlefield(state: GameState) {
  const mapSeed = Date.now() + state.frame;
  persistMapSeed(mapSeed);
  const walls = generateWalls(mapSeed);
  const p1 = randomSpawn(walls);
  const p2 = randomSpawn(walls, { x: p1.x, y: p1.y });
  return {
    ...state,
    mapSeed,
    refreshTimer: MAP_REFRESH_TICKS,
    bullets: [],
    explosions: [],
    debris: [],
    pedestrians: generatePedestrians(walls, mapSeed),
    explored: { p1: Array(FOG_COUNT).fill(false), p2: Array(FOG_COUNT).fill(false) },
    tanks: {
      p1: { ...state.tanks.p1, x: p1.x, y: p1.y, angle: p1.a, hp: 5, cooldown: 20, alive: true, respawn: 0, deathTime: 0 },
      p2: { ...state.tanks.p2, x: p2.x, y: p2.y, angle: p2.a, hp: 5, cooldown: 20, alive: true, respawn: 0, deathTime: 0 },
    },
    lastSeenEnemy: { p1: mapSeed, p2: mapSeed },
    showingHint: { p1: false, p2: false },
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

function isExplored(explored: boolean[], x: number, y: number) {
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
    tanks: { p1: { ...prev.tanks.p1 }, p2: { ...prev.tanks.p2 } },
    explored: { p1: [...prev.explored.p1], p2: [...prev.explored.p2] },
    lastSeenEnemy: { ...prev.lastSeenEnemy },
    showingHint: { ...prev.showingHint },
  };

  // 检查是否能看到敌人，更新最后看到的时间
  (Object.keys(next.tanks) as PlayerId[]).forEach((playerId) => {
    const enemyId = playerId === "p1" ? "p2" : "p1";
    const player = next.tanks[playerId];
    const enemy = next.tanks[enemyId];
    if (player.alive && enemy.alive) {
      const dist = Math.hypot(player.x - enemy.x, player.y - enemy.y);
      const canSeeEnemy = dist <= REVEAL_RADIUS;
      
      if (canSeeEnemy) {
        // 能看到敌人，重置所有状态
        next.lastSeenEnemy[playerId] = next.frame;
        next.showingHint[playerId] = false;
      } else {
        // 看不到敌人，检查是否需要显示提示或重置
        const timeSinceSeen = next.frame - next.lastSeenEnemy[playerId];
        
        if (timeSinceSeen >= 600 && timeSinceSeen < 720) {
          // 10-12秒，显示提示
          next.showingHint[playerId] = true;
        } else if (timeSinceSeen >= 720 && next.showingHint[playerId]) {
          // 超过12秒，结束提示并重置为10秒前的状态，开始下一个周期
          next.lastSeenEnemy[playerId] = next.frame - 600;
          next.showingHint[playerId] = false;
        }
      }
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

  // 坦克碰撞检测 - 撞击扣血 + 物理推开
  const p1 = next.tanks.p1;
  const p2 = next.tanks.p2;
  if (p1.alive && p2.alive) {
    const dx = p1.x - p2.x;
    const dy = p1.y - p2.y;
    const dist = Math.hypot(dx, dy);
    const minDist = TANK_R * 2;
    
    if (dist < minDist) {
      // 两个坦克相撞！
      const p1Input = inputs.p1 ?? EMPTY_INPUT;
      const p2Input = inputs.p2 ?? EMPTY_INPUT;
      const p1IsMoving = p1Input.up || p1Input.down || p1Input.left || p1Input.right;
      const p2IsMoving = p2Input.up || p2Input.down || p2Input.left || p2Input.right;
      
      // 物理推开效果（即使不扣血也要推开，避免重叠）
      const overlap = minDist - dist;
      const pushForce = overlap * 0.5; // 推开力度
      const nx = dx / dist;
      const ny = dy / dist;
      
      if (!isNaN(nx) && !isNaN(ny)) {
        // 尝试推开两个坦克
        const p1PushX = nx * pushForce;
        const p1PushY = ny * pushForce;
        const p2PushX = -nx * pushForce;
        const p2PushY = -ny * pushForce;
        
        // 只有不被墙壁挡住时才可以推开
        if (!blocked(p1.x + p1PushX, p1.y + p1PushY, TANK_R, walls)) {
          p1.x += p1PushX;
          p1.y += p1PushY;
        }
        if (!blocked(p2.x + p2PushX, p2.y + p2PushY, TANK_R, walls)) {
          p2.x += p2PushX;
          p2.y += p2PushY;
        }
      }

      // 只有冷却时间为0时才扣血！
      if (p1.crashCooldown === 0 && p2.crashCooldown === 0) {
        // 添加撞击爆炸效果
        const centerX = (p1.x + p2.x) / 2;
        const centerY = (p1.y + p2.y) / 2;
        next.explosions.push({ id: `crash-${next.frame}`, x: centerX, y: centerY, t: 24 });

        if (p1IsMoving && p2IsMoving) {
          // 双方都在移动，都扣血
          p1.hp -= 1;
          p2.hp -= 1;
        } else if (p1IsMoving) {
          // 只有P1在移动，只扣P2血
          p2.hp -= 1;
        } else if (p2IsMoving) {
          // 只有P2在移动，只扣P1血
          p1.hp -= 1;
        }
        
        // 设置撞击冷却时间（30帧 = 0.5秒）
        p1.crashCooldown = 30;
        p2.crashCooldown = 30;
        
        // 检查死亡
        [p1, p2].forEach(t => {
          if (t.hp <= 0) {
            t.alive = false;
            t.respawn = RESPAWN_TICKS;
            t.deathTime = next.frame; // 记录死亡时间
            const other = t.id === "p1" ? p2 : p1;
            other.score += 1;
            next.explosions.push({ id: `boom-${next.frame}`, x: t.x, y: t.y, t: 34 });
            // 生成爆炸碎片
            next.debris.push(...generateDebris(t, next.frame));
            if (other.score >= 5) {
              next.phase = "ended";
              next.winner = other.id;
            }
          }
        });
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
  const explored = state.explored[focus];
  const myTank = state.tanks[focus];
  const enemyId = focus === "p1" ? "p2" : "p1";
  const enemy = state.tanks[enemyId];

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

  // 检查是否需要显示敌人位置提示
  if (state.showingHint[focus] && enemy.alive && myTank.alive) {
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
  const me = state.tanks[focus];

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

  const explored = state.explored[focus];
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
    if (!t.alive) return;
    if (t.id !== focus && !isCurrentlyVisible(me, t.x, t.y)) return;
    const tankMesh = makeTankMesh(tankStyles[t.id], t.color);
    tankMesh.position.copy(worldToThree(t.x, t.y, 0));
    tankMesh.rotation.y = -t.angle;
    scene.add(tankMesh);
  });

  state.bullets.forEach((b) => {
    if (b.owner !== focus && !isCurrentlyVisible(me, b.x, b.y)) return;
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(6, 16, 10),
      new THREE.MeshStandardMaterial({ color: b.owner === "p1" ? 0xfff2a6 : 0xbaf6ff, emissive: b.owner === "p1" ? 0xffcf33 : 0x36e0ff, emissiveIntensity: 1.4 })
    );
    sphere.position.copy(worldToThree(b.x, b.y, 24));
    scene.add(sphere);
  });

  state.explosions.forEach((e) => {
    // 即使自己死亡也能看到自己的爆炸特效
    const distance = Math.hypot(me.x - e.x, me.y - e.y);
    const visible = distance <= REVEAL_RADIUS || isExplored(state.explored[focus], e.x, e.y);
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
  state.debris.forEach((d) => {
    // 即使自己死亡也能看到自己的碎片
    const distance = Math.hypot(me.x - d.x, me.y - d.y);
    const visible = distance <= REVEAL_RADIUS || isExplored(state.explored[focus], d.x, d.y);
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
  state.pedestrians.forEach((ped) => {
    // 检查路人是否可见（包括倒地状态）
    const distance = Math.hypot(me.x - ped.x, me.y - ped.y);
    const visible = distance <= REVEAL_RADIUS || isExplored(state.explored[focus], ped.x, ped.y);
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
  const [peerId, setPeerId] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [status, setStatus] = useState("待机：选择主机或加入。");
  const [connected, setConnected] = useState(false);
  const [state, setState] = useState<GameState>(() => freshState());
  const [localInput, setLocalInput] = useState<PlayerInput>(EMPTY_INPUT);
  const [tankStyles, setTankStyles] = useState<Record<PlayerId, TankStyleId>>({ p1: "vanguard", p2: "raptor" });
  const [helpOpen, setHelpOpen] = useState(false);
  const [shakeActive, setShakeActive] = useState(false);
  const [confettiBurst, setConfettiBurst] = useState(0);
  const [musicPlaying, setMusicPlaying] = useState(true);
  const [musicVolume, setMusicVolume] = useState(0.5);
  const [menuOpacity, setMenuOpacity] = useState(0.4); // 60%透明，更透明
  const [demoMode, setDemoMode] = useState(true);
  const [isSinglePlayer, setIsSinglePlayer] = useState(false); // 单机模式：AI作为2P
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hudRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<ThreeContext | null>(null);
  const peerRef = useRef<Peer | null>(null);
  const connRef = useRef<DataConnection | null>(null);
  const remoteInputRef = useRef<PlayerInput>(EMPTY_INPUT);
  const localInputRef = useRef<PlayerInput>(EMPTY_INPUT);
  const stateRef = useRef<GameState>(state);
  const fireLockRef = useRef(false);
  const lastHpRef = useRef<number | null>(null);
  const lastEnemyAliveRef = useRef<boolean | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const originalMusicVolumeRef = useRef(0.5);
  const synthRef = useRef<SpeechSynthesis | null>(null);
  const speechInitializedRef = useRef(false);
  const lastPedestriansAliveRef = useRef<Map<string, boolean>>(new Map());
  const menuRef = useRef<HTMLDivElement>(null);

  const playerId: PlayerId = role === "guest" ? "p2" : "p1";
  const enemyId: PlayerId = playerId === "p1" ? "p2" : "p1";
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
    state.pedestrians.forEach(ped => {
      aliveMap.set(ped.id, ped.alive);
    });
    lastPedestriansAliveRef.current = aliveMap;
  }, []);
  
  // 检测NPC死亡并播放语音
  useEffect(() => {
    if (!synthRef.current || state.phase !== 'playing') return;
    
    // 检查有哪些NPC刚刚死亡（之前活着，现在死了）
    let hasDeath = false;
    state.pedestrians.forEach(ped => {
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
    state.pedestrians.forEach(ped => {
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
    
    // 保持当前方向的计时器
    let currentDir1 = { up: true, down: false, left: false, right: false };
    let currentDir2 = { up: false, down: true, left: false, right: false };
    let dirTimer1 = 0;
    let dirTimer2 = 0;
    const changeDirEvery = 60; // 每60帧（约1秒）才考虑改变方向
    
    const demoTick = window.setInterval(() => {
      setState((prev) => {
        // 更新计时器
        dirTimer1++;
        dirTimer2++;
        
        // 坦克1：保持方向，偶尔改变
        if (dirTimer1 >= changeDirEvery) {
          dirTimer1 = 0;
          const rand = Math.random();
          if (rand < 0.3) {
            currentDir1 = { up: true, down: false, left: false, right: false };
          } else if (rand < 0.5) {
            currentDir1 = { up: false, down: true, left: false, right: false };
          } else if (rand < 0.7) {
            currentDir1 = { up: false, down: false, left: true, right: false };
          } else {
            currentDir1 = { up: false, down: false, left: false, right: true };
          }
        }
        
        // 坦克2：保持方向，偶尔改变
        if (dirTimer2 >= changeDirEvery) {
          dirTimer2 = 0;
          const rand = Math.random();
          if (rand < 0.3) {
            currentDir2 = { up: false, down: true, left: false, right: false };
          } else if (rand < 0.5) {
            currentDir2 = { up: true, down: false, left: false, right: false };
          } else if (rand < 0.7) {
            currentDir2 = { up: false, down: false, left: false, right: true };
          } else {
            currentDir2 = { up: false, down: false, left: true, right: false };
          }
        }
        
        const demoInput1: PlayerInput = {
          ...currentDir1,
          fire: Math.random() > 0.98, // 更低频率的射击
          suicide: false
        };
        
        const demoInput2: PlayerInput = {
          ...currentDir2,
          fire: Math.random() > 0.98,
          suicide: false
        };
        
        // 自动开始游戏如果还没开始
        if (prev.phase !== "playing" && Math.random() > 0.995) {
          const newState = freshState();
          newState.phase = "playing";
          return newState;
        }
        
        return stepGame(prev, { p1: demoInput1, p2: demoInput2 });
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

  // 单机模式AI控制ref
  const aiDir1Ref = useRef<{ up: boolean; down: boolean; left: boolean; right: boolean }>({ up: false, down: false, left: false, right: false });
  const aiDir2Ref = useRef<{ up: boolean; down: boolean; left: boolean; right: boolean }>({ up: true, down: false, left: false, right: false });
  const aiFrameCount1Ref = useRef(0);
  const aiFrameCount2Ref = useRef(0);

  useEffect(() => {
    if (role !== "host" && !isSinglePlayer) return;
    const tick = window.setInterval(() => {
      setState((prev) => {
        let p2Input = remoteInputRef.current;
        
        // 如果是单机模式，AI控制p2
        if (isSinglePlayer) {
          aiFrameCount2Ref.current++;
          
          if (aiFrameCount2Ref.current >= 60) {
            aiFrameCount2Ref.current = 0;
            const dirs = ["up", "down", "left", "right"] as const;
            const newDir = dirs[Math.floor(Math.random() * dirs.length)];
            aiDir2Ref.current = { up: false, down: false, left: false, right: false, [newDir]: true };
          }
          
          p2Input = {
            ...aiDir2Ref.current,
            fire: Math.random() > 0.98,
            suicide: false
          };
        }
        
        const next = stepGame(prev, { p1: localInputRef.current, p2: p2Input });
        if (connRef.current?.open) connRef.current.send({ type: "state", state: next } satisfies Message);
        return next;
      });
    }, 1000 / 60);
    return () => window.clearInterval(tick);
  }, [role, isSinglePlayer]);

  useEffect(() => {
    if (role === "guest" && connRef.current?.open) {
      connRef.current.send({ type: "input", input: localInput } satisfies Message);
    }
  }, [localInput, role]);

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
    connRef.current?.close();
    connRef.current = null;
    peerRef.current?.destroy();
    peerRef.current = null;
    remoteInputRef.current = EMPTY_INPUT;
    localInputRef.current = EMPTY_INPUT;
    setLocalInput(EMPTY_INPUT);
    setConnected(false);
    setPeerId("");
    setJoinCode("");
    setRole("menu");
    setIsSinglePlayer(false);
    setStatus("待机：选择主机或加入。");
    setState(freshState());
    toast("已退出房间");
  }, []);

  const attachConnection = useCallback((conn: DataConnection, mode: Role) => {
    console.log("🔗 开始建立连接，模式:", mode);
    connRef.current = conn;
    conn.on("open", () => {
      console.log("✅ 数据通道已打开！");
      setConnected(true);
      setStatus(mode === "host" ? "2P 已接入，按“开战”开始。" : "已接入主机，等待主机开战。");
      conn.send({ type: "join" } satisfies Message);
      toast.success("数据通道已连接");
    });
    conn.on("data", (raw) => {
      console.log("📨 收到数据:", raw);
      const msg = raw as Message;
      if (msg.type === "input") remoteInputRef.current = msg.input;
      if (msg.type === "state") setState(msg.state);
      if (msg.type === "restart" && mode === "host") {
        const ns = freshState(); ns.phase = "playing"; setState(ns);
      }
    });
    conn.on("error", (err) => {
      console.error("❌ 数据通道错误:", err);
      toast.error("数据通道错误");
    });
    conn.on("close", () => { 
      console.log("🔌 数据通道已关闭");
      setConnected(false);
      // 当连接断开时，所有玩家都退出房间
      setTimeout(() => {
        exitSession();
      }, 500);
    });
  }, [exitSession]);

  const createHost = () => {
    const id = roomCode();
    const peer = new Peer(id, { 
      debug: 2,
      ...PEER_CONFIG
    });
    peerRef.current = peer;
    setRole("host"); setPeerId(id); setStatus("正在启动主机信标……");
    peer.on("open", (openId) => {
      console.log("✅ 主机 ID 已分配:", openId, "配置:", PEER_CONFIG);
      setStatus("主机已开启，把房间码发给 2P。");
    });
    peer.on("connection", (conn) => {
      console.log("✅ 收到连接请求:", conn);
      attachConnection(conn, "host");
    });
    peer.on("error", (err) => { 
      console.error("❌ 主机错误:", err);
      setStatus(`主机错误：${err.type}`); 
      toast.error("主机启动失败，请查看控制台错误信息"); 
    });
  };

  const joinHost = () => {
    const code = joinCode.trim().toUpperCase();
    if (!code) return toast.error("先输入房间码");
    console.log("🚀 正在尝试加入房间:", code, "配置:", PEER_CONFIG);
    const peer = new Peer({ 
      debug: 2,
      ...PEER_CONFIG
    });
    peerRef.current = peer;
    setRole("guest"); setStatus("正在呼叫主机……");
    peer.on("open", (openId) => {
      console.log("✅ 客机 ID 已分配:", openId, "正在连接到主机:", code);
      const conn = peer.connect(code, { reliable: true });
      attachConnection(conn, "guest");
    });
    peer.on("error", (err) => { 
      console.error("❌ 加入失败:", err);
      setStatus(`加入失败：${err.type}`); 
      toast.error("加入失败，请查看控制台错误信息"); 
    });
  };

  const startGame = () => {
    const ns = freshState(); ns.phase = "playing";
    persistMapSeed(ns.mapSeed);
    setState(ns);
    connRef.current?.send({ type: "state", state: ns } satisfies Message);
  };

  const startSinglePlayer = () => {
    setIsSinglePlayer(true);
    setDemoMode(false);
    setRole("host"); // 单机模式也用host逻辑
    setStatus("单机模式：开始对战AI！");
    const ns = freshState();
    ns.phase = "playing";
    persistMapSeed(ns.mapSeed);
    setState(ns);
  };

  const restart = () => {
    if (role === "host") startGame();
    else connRef.current?.send({ type: "restart" } satisfies Message);
  };

  const copyRoomCode = useCallback(async () => {
    if (!peerId) return;
    await navigator.clipboard?.writeText(peerId);
    toast.success("房间码已复制");
  }, [peerId]);

  const menuVisible = role === "menu" || state.phase !== "playing";
  const showExit = role !== "menu";
  const myTank = state.tanks[playerId];
  const enemyTank = state.tanks[enemyId];
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
                      <Swords className="mt-1 h-9 w-9 shrink-0 text-[#36e0ff]" />
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
                            <button onClick={copyRoomCode} className="mt-1 text-3xl font-black tracking-wider text-[#ffcf33]">{peerId}</button>
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
