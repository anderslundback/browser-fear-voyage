import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

// Types
interface Vec2 { x: number; y: number }
interface Entity { pos: Vec2; vel: Vec2; radius: number; alive: boolean }
interface Player extends Entity { speed: number; cooldown: number }
interface Bullet extends Entity { fromPlayer: boolean }
interface Enemy extends Entity { hp: number; pattern: number; t: number }
interface Particle { pos: Vec2; vel: Vec2; life: number; color: string }

const INTERNAL_WIDTH = 480;
const INTERNAL_HEIGHT = 720;

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
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
  const starsRef = useRef<{ x: number; y: number; z: number }[]>([]);
  // Jungle ground pattern tile and pattern
  const groundTileRef = useRef<HTMLCanvasElement | null>(null);
  const groundPatternRef = useRef<CanvasPattern | null>(null);
  const lastTimeRef = useRef<number | null>(null);
  const spawnTimerRef = useRef(0);
  const aimRef = useRef<Vec2>({ x: INTERNAL_WIDTH / 2, y: INTERNAL_HEIGHT / 2 - 120 });
  const firingRef = useRef(false);

  // Build jungle ground tile once
  const buildJungleTile = () => {
    if (groundTileRef.current) return;
    const tile = document.createElement("canvas");
    tile.width = 160;
    tile.height = 160;
    const c = tile.getContext("2d");
    if (!c) return;
    // base ground
    c.fillStyle = "hsl(140, 20%, 8%)";
    c.fillRect(0, 0, tile.width, tile.height);
    // leaf clusters
    for (let i = 0; i < 28; i++) {
      const x = Math.random() * tile.width;
      const y = Math.random() * tile.height;
      const r = 8 + Math.random() * 14;
      c.save();
      c.translate(x, y);
      c.rotate(Math.random() * Math.PI);
      c.fillStyle = "hsla(140, 28%, 14%, 0.7)";
      c.beginPath();
      c.moveTo(0, -r);
      c.quadraticCurveTo(r * 0.8, -r * 0.2, 0, r);
      c.quadraticCurveTo(-r * 0.8, -r * 0.2, 0, -r);
      c.fill();
      c.restore();
    }
    // speckled debris
    for (let i = 0; i < 260; i++) {
      const x = Math.random() * tile.width;
      const y = Math.random() * tile.height;
      c.fillStyle = i % 2 ? "hsla(140, 16%, 12%, 0.5)" : "hsla(140, 12%, 10%, 0.4)";
      c.fillRect(x, y, 1, 1);
    }
    groundTileRef.current = tile;
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
      pos: { x: INTERNAL_WIDTH / 2, y: INTERNAL_HEIGHT - 80 },
      vel: { x: 0, y: 0 },
      radius: 16,
      alive: true,
      speed: 260,
      cooldown: 0,
    };
    bulletsRef.current = [];
    enemiesRef.current = [];
    particlesRef.current = [];
    starsRef.current = Array.from({ length: 120 }, () => ({
      x: Math.random() * INTERNAL_WIDTH,
      y: Math.random() * INTERNAL_HEIGHT,
      z: Math.random() * 2 + 0.5,
    }));
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

    // ensure jungle ground pattern
    if (!groundPatternRef.current) {
      if (!groundTileRef.current) buildJungleTile();
      if (groundTileRef.current) {
        groundPatternRef.current = ctx.createPattern(groundTileRef.current, "repeat");
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
    const player = playerRef.current;
    if (!player) return;

    // Move player
    const left = keys.current["arrowleft"] || keys.current["a"]; 
    const right = keys.current["arrowright"] || keys.current["d"]; 
    const up = keys.current["arrowup"] || keys.current["w"]; 
    const down = keys.current["arrowdown"] || keys.current["s"]; 

    player.vel.x = (right ? 1 : 0) - (left ? 1 : 0);
    player.vel.y = (down ? 1 : 0) - (up ? 1 : 0);

    const len = Math.hypot(player.vel.x, player.vel.y) || 1;
    player.pos.x = clamp(player.pos.x + (player.vel.x / len) * player.speed * dt, 20, INTERNAL_WIDTH - 20);
    player.pos.y = clamp(player.pos.y + (player.vel.y / len) * player.speed * dt, 20, INTERNAL_HEIGHT - 20);

    // Shooting (rapid-fire, toward aim)
    player.cooldown -= dt;
    const firing = firingRef.current || keys.current[" "] || keys.current["space"];
    if (firing && player.cooldown <= 0) {
      const ax = aimRef.current.x - player.pos.x;
      const ay = aimRef.current.y - player.pos.y;
      const L = Math.hypot(ax, ay) || 1;
      const dirx = ax / L;
      const diry = ay / L;
      const speed = 820;
      bulletsRef.current.push({
        pos: { x: player.pos.x + dirx * 18, y: player.pos.y + diry * 18 },
        vel: { x: dirx * speed, y: diry * speed },
        radius: 3.5,
        alive: true,
        fromPlayer: true,
      });
      player.cooldown = 0.06;
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

    // Spawn enemies
    spawnTimerRef.current -= dt;
    if (spawnTimerRef.current <= 0) {
      spawnWave();
      spawnTimerRef.current = Math.max(0.6, 2.4 - score * 0.002);
    }

    // Update enemies (seek the player)
    enemiesRef.current.forEach((e) => {
      e.t += dt;
      const player = playerRef.current;
      if (!player) return;
      const dx = player.pos.x - e.pos.x;
      const dy = player.pos.y - e.pos.y;
      const l = Math.hypot(dx, dy) || 1;
      const base = 48 + Math.min(140, score * 0.05);
      const jitterX = Math.sin(e.t * 2 + e.pos.y * 0.03) * 14;
      const jitterY = Math.cos(e.t * 2 + e.pos.x * 0.03) * 14;
      e.pos.x += (dx / l) * base * dt + jitterX * dt;
      e.pos.y += (dy / l) * base * dt + jitterY * dt;
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

    // Stars
    starsRef.current.forEach((s) => {
      const drift = 6 + s.z * 8;
      s.x += Math.sin((s.y + s.z) * 0.05) * drift * dt;
      s.y += Math.cos((s.x + s.z) * 0.05) * drift * dt;
      if (s.x < 0) s.x += INTERNAL_WIDTH;
      if (s.x > INTERNAL_WIDTH) s.x -= INTERNAL_WIDTH;
      if (s.y < 0) s.y += INTERNAL_HEIGHT;
      if (s.y > INTERNAL_HEIGHT) s.y -= INTERNAL_HEIGHT;
    });
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
      player.pos = { x: INTERNAL_WIDTH / 2, y: INTERNAL_HEIGHT - 80 };
    }
  };

  const emitExplosion = (x: number, y: number, color: string) => {
    for (let i = 0; i < 24; i++) {
      const a = (Math.PI * 2 * i) / 24 + Math.random() * 0.3;
      const sp = 80 + Math.random() * 120;
      particlesRef.current.push({
        pos: { x, y },
        vel: { x: Math.cos(a) * sp, y: Math.sin(a) * sp },
        life: 0.6 + Math.random() * 0.4,
        color,
      });
    }
  };

  const spawnWave = () => {
    const count = 6 + Math.floor(Math.random() * 4) + Math.floor(score / 300);
    for (let i = 0; i < count; i++) {
      const side = Math.floor(Math.random() * 4); // 0:top,1:right,2:bottom,3:left
      let x = 0, y = 0;
      if (side === 0) { x = Math.random() * INTERNAL_WIDTH; y = -30; }
      else if (side === 1) { x = INTERNAL_WIDTH + 30; y = Math.random() * INTERNAL_HEIGHT; }
      else if (side === 2) { x = Math.random() * INTERNAL_WIDTH; y = INTERNAL_HEIGHT + 30; }
      else { x = -30; y = Math.random() * INTERNAL_HEIGHT; }
      enemiesRef.current.push({
        pos: { x, y },
        vel: { x: 0, y: 0 },
        radius: 16,
        alive: true,
        hp: 1 + Math.floor(score / 600),
        pattern: Math.floor(Math.random() * 3),
        t: 0,
      });
    }
  };

  const draw = (ctx: CanvasRenderingContext2D) => {
    // scale for crisp rendering
    ctx.clearRect(0, 0, INTERNAL_WIDTH, INTERNAL_HEIGHT);

    // Jungle ground pattern
    if (groundPatternRef.current) {
      ctx.fillStyle = groundPatternRef.current;
    } else {
      const bg = ctx.createLinearGradient(0, 0, 0, INTERNAL_HEIGHT);
      bg.addColorStop(0, "hsl(140, 20%, 6%)");
      bg.addColorStop(1, "hsl(140, 22%, 4%)");
      ctx.fillStyle = bg;
    }
    ctx.fillRect(0, 0, INTERNAL_WIDTH, INTERNAL_HEIGHT);

    // subtle ambient moonlight to reveal ground and enemies
    const ambient = ctx.createRadialGradient(
      INTERNAL_WIDTH * 0.5,
      INTERNAL_HEIGHT * 0.2,
      20,
      INTERNAL_WIDTH * 0.5,
      INTERNAL_HEIGHT * 0.2,
      INTERNAL_HEIGHT * 0.9
    );
    ambient.addColorStop(0, "rgba(255,255,255,0.07)");
    ambient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = ambient;
    ctx.fillRect(0, 0, INTERNAL_WIDTH, INTERNAL_HEIGHT);

    // fireflies in the jungle
    for (const s of starsRef.current) {
      const alpha = 0.15 + s.z * 0.25;
      ctx.fillStyle = `hsla(${120 + s.z * 20}, 50%, ${35 + s.z * 25}%, ${alpha})`;
      ctx.fillRect(s.x, s.y, 2, 2);
    }

    // particles
    for (const p of particlesRef.current) {
      ctx.fillStyle = p.color;
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
      ctx.beginPath();
      ctx.arc(p.pos.x, p.pos.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // bullets
    ctx.fillStyle = "hsl(var(--accent))";
    bulletsRef.current.forEach((b) => {
      ctx.beginPath();
      ctx.arc(b.pos.x, b.pos.y, b.radius, 0, Math.PI * 2);
      ctx.fill();
    });

    // enemies (alien glow)
    enemiesRef.current.forEach((e) => {
      ctx.save();
      const grd = ctx.createRadialGradient(e.pos.x, e.pos.y, 4, e.pos.x, e.pos.y, 20);
      grd.addColorStop(0, "hsla(135,80%,55%,0.9)");
      grd.addColorStop(1, "hsla(135,80%,30%,0.15)");
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(e.pos.x, e.pos.y, e.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });

    // player (marine) aiming toward flashlight
    const player = playerRef.current;
    if (player && player.alive) {
      ctx.save();
      const aim = aimRef.current;
      const ang = Math.atan2(aim.y - player.pos.y, aim.x - player.pos.x);
      ctx.translate(player.pos.x, player.pos.y);
      ctx.rotate(ang + Math.PI / 2);
      ctx.fillStyle = "hsl(var(--primary))";
      ctx.strokeStyle = "hsl(var(--primary))";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, -18);
      ctx.lineTo(14, 12);
      ctx.lineTo(0, 6);
      ctx.lineTo(-14, 12);
      ctx.closePath();
      ctx.fill();
      ctx.shadowColor = "hsla(258,85%,62%,0.6)";
      ctx.shadowBlur = 12;
      ctx.stroke();
      ctx.restore();

      // flashlight cone (reveals darkness ahead)
      ctx.save();
      // darkness overlay
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "rgba(0,0,0,0.78)";
      ctx.fillRect(0, 0, INTERNAL_WIDTH, INTERNAL_HEIGHT);
      // cut out a cone in front of the player
      const len = 240;
      const spread = Math.PI / 6; // 30°
      const pAng = ang;
      const p1x = player.pos.x + Math.cos(pAng - spread) * len;
      const p1y = player.pos.y + Math.sin(pAng - spread) * len;
      const p2x = player.pos.x + Math.cos(pAng + spread) * len;
      const p2y = player.pos.y + Math.sin(pAng + spread) * len;

      ctx.globalCompositeOperation = "destination-out";
      ctx.beginPath();
      ctx.moveTo(player.pos.x, player.pos.y);
      ctx.lineTo(p1x, p1y);
      ctx.arc(player.pos.x, player.pos.y, len, pAng - spread, pAng + spread);
      ctx.closePath();
      const cone = ctx.createRadialGradient(player.pos.x, player.pos.y, 0, player.pos.x, player.pos.y, len);
      cone.addColorStop(0, "rgba(0,0,0,1)");
      cone.addColorStop(0.6, "rgba(0,0,0,0.6)");
      cone.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = cone;
      ctx.fill();
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
            <div className="text-sm sm:text-base font-medium">Score: {score}</div>
            <div className="text-sm sm:text-base font-medium">Lives: {lives}</div>
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
                  <h2 className="text-2xl font-semibold">Phobia 2 – Top-Down Shooter</h2>
                  <p className="text-muted-foreground">WASD / Arrows to move • Space to shoot • P to pause</p>
                  <Button variant="hero" size="lg" onClick={initGame} className="hover-scale">Start</Button>
                </div>
              </div>
            )}
            {paused && !gameOver && (
              <div className="absolute inset-0 grid place-items-center bg-background/40 backdrop-blur-sm">
                <div className="text-center space-y-4 p-6">
                  <h3 className="text-xl font-semibold">Paused</h3>
                  <Button variant="secondary" onClick={() => setPaused(false)}>Resume</Button>
                </div>
              </div>
            )}
            {gameOver && (
              <div className="absolute inset-0 grid place-items-center bg-background/70 backdrop-blur">
                <div className="text-center space-y-4 p-6">
                  <h3 className="text-2xl font-semibold">Game Over</h3>
                  <p className="text-muted-foreground">Final Score: {score}</p>
                  <Button variant="hero" size="lg" onClick={initGame}>Play Again</Button>
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
