import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

// Types
interface Vec2 {
  x: number;
  y: number;
}
interface Entity {
  pos: Vec2;
  vel: Vec2;
  radius: number;
  alive: boolean;
}
interface Player extends Entity {
  speed: number;
  cooldown: number;
}
interface Bullet extends Entity {
  fromPlayer: boolean;
}
interface Enemy extends Entity {
  hp: number;
  pattern: number;
  t: number;
}
interface Particle {
  pos: Vec2;
  vel: Vec2;
  life: number;
  color: string;
}

const INTERNAL_WIDTH = 480;
const INTERNAL_HEIGHT = 720;

const clamp = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, v));
const dist2 = (a: Vec2, b: Vec2) => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
};

export const GameCanvas = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(3);

  // signature moment: reactive gradient glow following pointer
  const glowRef = useRef<HTMLDivElement | null>(null);

  const keys = useRef<Record<string, boolean>>({});
  const playerRef = useRef<Player | null>(null);
  const bulletsRef = useRef<Bullet[]>([]);
  const enemiesRef = useRef<Enemy[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  // Green field background pattern
  const fieldTileRef = useRef<HTMLCanvasElement | null>(null);
  const fieldPatternRef = useRef<CanvasPattern | null>(null);
  const timeRef = useRef(0);
  const lastTimeRef = useRef<number | null>(null);
  const spawnTimerRef = useRef(0);
  const aimRef = useRef<Vec2>({
    x: INTERNAL_WIDTH / 2,
    y: INTERNAL_HEIGHT / 2 - 120,
  });
  const firingRef = useRef(false);

  // Build green field tile (simplified grassy field like original)
  const buildFieldTile = () => {
    if (fieldTileRef.current) return;
    const tile = document.createElement("canvas");
    tile.width = 128;
    tile.height = 128;
    const c = tile.getContext("2d");
    if (!c) return;

    // Base green field
    c.fillStyle = "hsl(85, 40%, 25%)";
    c.fillRect(0, 0, tile.width, tile.height);

    // Grass texture patches
    for (let i = 0; i < 40; i++) {
      const x = Math.random() * tile.width;
      const y = Math.random() * tile.height;
      const size = 2 + Math.random() * 4;
      c.fillStyle = `hsl(${80 + Math.random() * 20}, ${
        35 + Math.random() * 15
      }%, ${20 + Math.random() * 15}%)`;
      c.fillRect(x, y, size, size);
    }

    // Some darker spots for variation
    for (let i = 0; i < 15; i++) {
      const x = Math.random() * tile.width;
      const y = Math.random() * tile.height;
      const r = 3 + Math.random() * 8;
      c.fillStyle = "hsla(85, 30%, 18%, 0.6)";
      c.beginPath();
      c.arc(x, y, r, 0, Math.PI * 2);
      c.fill();
    }

    fieldTileRef.current = tile;
  };

  // Setup input
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      keys.current[e.key.toLowerCase()] = true;
      keys.current[e.code.toLowerCase()] = true;
      if (e.key === "p" || e.key === "P") setPaused((p) => !p);
    };
    const up = (e: KeyboardEvent) => {
      keys.current[e.key.toLowerCase()] = false;
      keys.current[e.code.toLowerCase()] = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  // Start / Restart
  const initGame = () => {
    setScore(0);
    setLives(3);
    setGameOver(false);
    setPaused(false);

    playerRef.current = {
      pos: { x: INTERNAL_WIDTH / 2, y: INTERNAL_HEIGHT / 2 },
      vel: { x: 0, y: 0 },
      radius: 12,
      alive: true,
      speed: 180,
      cooldown: 0,
    };
    bulletsRef.current = [];
    enemiesRef.current = [];
    particlesRef.current = [];
    spawnTimerRef.current = 0;
    lastTimeRef.current = null;
    setRunning(true);
  };

  // Pointer reactive glow
  useEffect(() => {
    const el = glowRef.current;
    const move = (e: PointerEvent) => {
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      el.style.setProperty("--mx", `${x}px`);
      el.style.setProperty("--my", `${y}px`);
    };
    window.addEventListener("pointermove", move);
    return () => window.removeEventListener("pointermove", move);
  }, []);

  // Game loop + pointer controls
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // ensure field pattern
    if (!fieldPatternRef.current) {
      if (!fieldTileRef.current) buildFieldTile();
      if (fieldTileRef.current) {
        fieldPatternRef.current = ctx.createPattern(
          fieldTileRef.current,
          "repeat"
        );
      }
    }

    let isPointerDown = false;
    const toCanvas = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      const x = ((clientX - rect.left) / rect.width) * INTERNAL_WIDTH;
      const y = ((clientY - rect.top) / rect.height) * INTERNAL_HEIGHT;
      return { x, y };
    };
    const onPointerDown = (e: PointerEvent) => {
      isPointerDown = true;
      const { x, y } = toCanvas(e.clientX, e.clientY);
      aimRef.current = { x, y };
      firingRef.current = true;
    };
    const onPointerMove = (e: PointerEvent) => {
      const { x, y } = toCanvas(e.clientX, e.clientY);
      aimRef.current = { x, y };
    };
    const onPointerUp = () => {
      isPointerDown = false;
      firingRef.current = false;
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);

    const loop = (t: number) => {
      rafRef.current = requestAnimationFrame(loop);
      if (!running || paused || gameOver) {
        lastTimeRef.current = t;
        return;
      }
      const last = lastTimeRef.current ?? t;
      const dt = Math.min(0.033, (t - last) / 1000);
      lastTimeRef.current = t;

      update(dt);
      draw(ctx);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, paused, gameOver]);

  const update = (dt: number) => {
    timeRef.current += dt;
    const player = playerRef.current;
    if (!player) return;

    // Move player (classic WASD/Arrow movement)
    const left = keys.current["arrowleft"] || keys.current["a"]; 
    const right = keys.current["arrowright"] || keys.current["d"]; 
    const up = keys.current["arrowup"] || keys.current["w"]; 
    const down = keys.current["arrowdown"] || keys.current["s"]; 

    player.vel.x = (right ? 1 : 0) - (left ? 1 : 0);
    player.vel.y = (down ? 1 : 0) - (up ? 1 : 0);

    const len = Math.hypot(player.vel.x, player.vel.y) || 1;
    player.pos.x = clamp(
      player.pos.x + (player.vel.x / len) * player.speed * dt,
      15,
      INTERNAL_WIDTH - 15
    );
    player.pos.y = clamp(
      player.pos.y + (player.vel.y / len) * player.speed * dt,
      15,
      INTERNAL_HEIGHT - 15
    );

    // Rapid-fire shooting (basic rifle style)
    player.cooldown -= dt;
    const firing =
      firingRef.current || keys.current[" "] || keys.current["space"];
    if (firing && player.cooldown <= 0) {
      const ax = aimRef.current.x - player.pos.x;
      const ay = aimRef.current.y - player.pos.y;
      const L = Math.hypot(ax, ay) || 1;
      const dirx = ax / L;
      const diry = ay / L;
      const speed = 400;
      bulletsRef.current.push({
        pos: { x: player.pos.x + dirx * 15, y: player.pos.y + diry * 15 },
        vel: { x: dirx * speed, y: diry * speed },
        radius: 2,
        alive: true,
        fromPlayer: true,
      });
      player.cooldown = 0.08; // Slower than before, more like original
    }

    // Update bullets
    bulletsRef.current.forEach((b) => {
      b.pos.x += b.vel.x * dt;
      b.pos.y += b.vel.y * dt;
      if (
        b.pos.y < -10 ||
        b.pos.y > INTERNAL_HEIGHT + 10 ||
        b.pos.x < -10 ||
        b.pos.x > INTERNAL_WIDTH + 10
      )
        b.alive = false;
    });
    bulletsRef.current = bulletsRef.current.filter((b) => b.alive);

    // Spawn enemies (robot-frog aliens from all edges)
    spawnTimerRef.current -= dt;
    if (spawnTimerRef.current <= 0) {
      spawnWave();
      spawnTimerRef.current = Math.max(0.8, 2.0 - score * 0.001);
    }

    // Update enemies (simple direct approach)
    enemiesRef.current.forEach((e) => {
      e.t += dt;
      const player = playerRef.current;
      if (!player) return;
      const dx = player.pos.x - e.pos.x;
      const dy = player.pos.y - e.pos.y;
      const l = Math.hypot(dx, dy) || 1;
      const base = 35 + Math.min(80, score * 0.03);
      e.pos.x += (dx / l) * base * dt;
      e.pos.y += (dy / l) * base * dt;
    });
    enemiesRef.current = enemiesRef.current.filter((e) => e.alive);

    // Collisions bullets -> enemies
    outer: for (const b of bulletsRef.current) {
      if (!b.fromPlayer) continue;
      for (const e of enemiesRef.current) {
        const r = b.radius + e.radius;
        if (dist2(b.pos, e.pos) <= r * r) {
          b.alive = false;
          e.hp -= 1;
          emitExplosion(e.pos.x, e.pos.y, "hsl(var(--accent))");
          if (e.hp <= 0) {
            e.alive = false;
            setScore((s) => s + 100);
            emitExplosion(e.pos.x, e.pos.y, "hsl(var(--primary))");
          }
          continue outer;
        }
      }
    }

    // Collisions enemies -> player
    for (const e of enemiesRef.current) {
      if (!player.alive) break;
      const r = player.radius + e.radius;
      if (dist2(player.pos, e.pos) <= r * r) {
        e.alive = false;
        hitPlayer(player);
        break;
      }
    }

    // Update particles
    particlesRef.current.forEach((p) => {
      p.life -= dt;
      p.pos.x += p.vel.x * dt;
      p.pos.y += p.vel.y * dt;
    });
    particlesRef.current = particlesRef.current.filter((p) => p.life > 0);
  };

  const hitPlayer = (player: Player) => {
    emitExplosion(player.pos.x, player.pos.y, "hsl(var(--destructive))");
    setLives((l) => l - 1);
    if (lives - 1 <= 0) {
      player.alive = false;
      setGameOver(true);
      setRunning(false);
    } else {
      // brief invulnerable reposition
      player.pos = { x: INTERNAL_WIDTH / 2, y: INTERNAL_HEIGHT / 2 };
    }
  };

  const emitExplosion = (x: number, y: number, color: string) => {
    for (let i = 0; i < 16; i++) {
      const a = (Math.PI * 2 * i) / 16 + Math.random() * 0.3;
      const sp = 60 + Math.random() * 80;
      particlesRef.current.push({
        pos: { x, y },
        vel: { x: Math.cos(a) * sp, y: Math.sin(a) * sp },
        life: 0.4 + Math.random() * 0.3,
        color,
      });
    }
  };

  const spawnWave = () => {
    const count = 4 + Math.floor(Math.random() * 3) + Math.floor(score / 500);
    for (let i = 0; i < count; i++) {
      const side = Math.floor(Math.random() * 4); // 0:top,1:right,2:bottom,3:left
      let x = 0,
        y = 0;
      if (side === 0) {
        x = Math.random() * INTERNAL_WIDTH;
        y = -25;
      } else if (side === 1) {
        x = INTERNAL_WIDTH + 25;
        y = Math.random() * INTERNAL_HEIGHT;
      } else if (side === 2) {
        x = Math.random() * INTERNAL_WIDTH;
        y = INTERNAL_HEIGHT + 25;
      } else {
        x = -25;
        y = Math.random() * INTERNAL_HEIGHT;
      }
      enemiesRef.current.push({
        pos: { x, y },
        vel: { x: 0, y: 0 },
        radius: 14,
        alive: true,
        hp: 1 + Math.floor(score / 800),
        pattern: Math.floor(Math.random() * 3),
        t: 0,
      });
    }
  };

  const draw = (ctx: CanvasRenderingContext2D) => {
    ctx.clearRect(0, 0, INTERNAL_WIDTH, INTERNAL_HEIGHT);

    // Green field background (like original)
    if (fieldPatternRef.current) {
      ctx.fillStyle = fieldPatternRef.current;
    } else {
      ctx.fillStyle = "hsl(85, 40%, 25%)";
    }
    ctx.fillRect(0, 0, INTERNAL_WIDTH, INTERNAL_HEIGHT);

    // particles (blood/gore effects)
    for (const p of particlesRef.current) {
      ctx.fillStyle = p.color;
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
      ctx.beginPath();
      ctx.arc(p.pos.x, p.pos.y, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // bullets (simple white/yellow dots)
    ctx.fillStyle = "hsl(50, 90%, 80%)";
    ctx.strokeStyle = "hsl(50, 90%, 60%)";
    ctx.lineWidth = 1;
    bulletsRef.current.forEach((b) => {
      ctx.beginPath();
      ctx.arc(b.pos.x, b.pos.y, b.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });

    // enemies (robot-frog aliens - simple green/gray sprites)
    enemiesRef.current.forEach((e) => {
      ctx.save();
      // Body
      ctx.fillStyle = "hsl(120, 40%, 30%)";
      ctx.strokeStyle = "hsl(120, 50%, 20%)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(e.pos.x, e.pos.y, e.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Simple "spindly limbs" effect
      const t = e.t * 4;
      for (let i = 0; i < 4; i++) {
        const angle = (Math.PI * 2 * i) / 4 + t;
        const limbX = e.pos.x + Math.cos(angle) * (e.radius + 4);
        const limbY = e.pos.y + Math.sin(angle) * (e.radius + 4);
        ctx.strokeStyle = "hsl(120, 30%, 25%)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(e.pos.x, e.pos.y);
        ctx.lineTo(limbX, limbY);
        ctx.stroke();
      }

      // Simple eyes
      ctx.fillStyle = "hsl(0, 80%, 60%)";
      ctx.beginPath();
      ctx.arc(e.pos.x - 4, e.pos.y - 3, 2, 0, Math.PI * 2);
      ctx.arc(e.pos.x + 4, e.pos.y - 3, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });

    // player (simple human soldier sprite)
    const player = playerRef.current;
    if (player && player.alive) {
      ctx.save();
      const aim = aimRef.current;
      const ang = Math.atan2(aim.y - player.pos.y, aim.x - player.pos.x);
      ctx.translate(player.pos.x, player.pos.y);
      ctx.rotate(ang + Math.PI / 2);

      // Simple soldier body
      ctx.fillStyle = "hsl(var(--primary))";
      ctx.strokeStyle = "hsl(var(--primary-foreground))";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, -12);
      ctx.lineTo(8, 8);
      ctx.lineTo(0, 4);
      ctx.lineTo(-8, 8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Weapon barrel
      ctx.strokeStyle = "hsl(40, 50%, 40%)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, -12);
      ctx.lineTo(0, -20);
      ctx.stroke();

      ctx.restore();
    }
  };

  useEffect(() => {
    if (!gameOver) return;
    // create a burst when game ends
    const p = playerRef.current;
    if (p) emitExplosion(p.pos.x, p.pos.y, "hsl(var(--destructive))");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameOver]);

  return (
    <section className="w-full">
      <div className="relative mx-auto max-w-4xl">
        <div
          ref={glowRef}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background: `radial-gradient(400px 200px at var(--mx,50%) var(--my,40%), hsl(var(--primary)/0.15), transparent 60%)`,
            transition: "var(--transition-smooth)",
          }}
        />
        <div className="rounded-xl border border-border bg-card shadow-[var(--shadow-elegant)] overflow-hidden">
          <div className="flex items-center justify-between p-3 sm:p-4">
            <div className="text-sm sm:text-base font-medium">
              Score: {score}
            </div>
            <div className="text-sm sm:text-base font-medium">
              Lives: {lives}
            </div>
          </div>
          <div className="relative">
            <canvas
              ref={canvasRef}
              width={INTERNAL_WIDTH}
              height={INTERNAL_HEIGHT}
              className="block w-full h-[70vh] max-h-[820px] bg-background"
            />
            {!running && !gameOver && (
              <div className="absolute inset-0 grid place-items-center bg-background/60 backdrop-blur-sm animate-fade-in">
                <div className="text-center space-y-4 p-6">
                  <h2 className="text-2xl font-semibold">
                    Phobia 2 – Classic Arcade Shooter
                  </h2>
                  <p className="text-muted-foreground">
                    WASD / Arrows to move • Mouse to aim • Click/Space to shoot
                    • P to pause
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Survive the endless alien swarm!
                  </p>
                  <Button size="lg" onClick={initGame} className="hover-scale">
                    Start Game
                  </Button>
                </div>
              </div>
            )}
            {paused && !gameOver && (
              <div className="absolute inset-0 grid place-items-center bg-background/40 backdrop-blur-sm">
                <div className="text-center space-y-4 p-6">
                  <h3 className="text-xl font-semibold">Game Paused</h3>
                  <p className="text-sm text-muted-foreground">
                    Press P to resume or click below
                  </p>
                  <Button variant="secondary" onClick={() => setPaused(false)}>
                    Resume Game
                  </Button>
                </div>
              </div>
            )}
            {gameOver && (
              <div className="absolute inset-0 grid place-items-center bg-background/70 backdrop-blur">
                <div className="text-center space-y-4 p-6">
                  <h3 className="text-2xl font-semibold">Game Over</h3>
                  <p className="text-muted-foreground">
                    You survived and scored: {score} points
                  </p>
                  <p className="text-xs text-muted-foreground">
                    The alien swarm got you in the end...
                  </p>
                  <Button variant="hero" size="lg" onClick={initGame}>
                    Play Again
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};

export default GameCanvas;
