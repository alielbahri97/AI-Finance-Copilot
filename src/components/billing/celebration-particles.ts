/**
 * Full-viewport celebration particles (gems, confetti, sparkles).
 * Multi-origin bursts + falling rain; respects prefers-reduced-motion.
 */

export type ParticleKind = "confetti" | "gem" | "sparkle" | "ribbon";

export type Particle = {
  kind: ParticleKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  accent: string;
  size: number;
  rotation: number;
  spin: number;
  life: number;
  decay: number;
  wobble: number;
  wobbleSpeed: number;
  twinkle: number;
};

/** Ballast teal + premium gold/amber — no purple glow spam. */
export const CELEBRATION_COLORS = [
  "#0f766e",
  "#0d9488",
  "#14b8a6",
  "#2dd4bf",
  "#f59e0b",
  "#fbbf24",
  "#fcd34d",
  "#e2e8f0",
  "#94a3b8",
] as const;

const GEM_COLORS = ["#0f766e", "#14b8a6", "#f59e0b", "#fbbf24"] as const;
const SPARKLE_COLORS = ["#fcd34d", "#fbbf24", "#e2e8f0", "#2dd4bf"] as const;

function pick<T extends readonly string[]>(palette: T): T[number] {
  return palette[Math.floor(Math.random() * palette.length)]!;
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return true;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function makeBurstParticle(
  originX: number,
  originY: number,
  kind: ParticleKind,
  options?: { upwardBias?: number; speedScale?: number }
): Particle {
  const upwardBias = options?.upwardBias ?? 3.5;
  const speedScale = options?.speedScale ?? 1;
  const angle = Math.random() * Math.PI * 2;
  const speed = (3.2 + Math.random() * 10) * speedScale;

  let color: string;
  let accent: string;
  let size: number;
  let decay: number;

  switch (kind) {
    case "gem":
      color = pick(GEM_COLORS);
      accent = color === "#f59e0b" || color === "#fbbf24" ? "#fff7ed" : "#ccfbf1";
      size = 7 + Math.random() * 9;
      decay = 0.004 + Math.random() * 0.003;
      break;
    case "sparkle":
      color = pick(SPARKLE_COLORS);
      accent = "#ffffff";
      size = 2 + Math.random() * 3.5;
      decay = 0.01 + Math.random() * 0.008;
      break;
    case "ribbon":
      color = pick(CELEBRATION_COLORS);
      accent = color;
      size = 8 + Math.random() * 14;
      decay = 0.005 + Math.random() * 0.004;
      break;
    default:
      color = pick(CELEBRATION_COLORS);
      accent = color;
      size = 4 + Math.random() * 7;
      decay = 0.0055 + Math.random() * 0.004;
  }

  return {
    kind,
    x: originX + (Math.random() - 0.5) * 24,
    y: originY + (Math.random() - 0.5) * 18,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed - upwardBias,
    color,
    accent,
    size,
    rotation: Math.random() * Math.PI * 2,
    spin: (Math.random() - 0.5) * 0.28,
    life: 1,
    decay,
    wobble: Math.random() * Math.PI * 2,
    wobbleSpeed: 0.04 + Math.random() * 0.08,
    twinkle: Math.random() * Math.PI * 2,
  };
}

function makeFaller(width: number, kind: ParticleKind): Particle {
  const x = Math.random() * width;
  const y = -20 - Math.random() * 80;
  const base = makeBurstParticle(x, y, kind, { upwardBias: 0, speedScale: 0.35 });
  base.vx = (Math.random() - 0.5) * 2.2;
  base.vy = 1.2 + Math.random() * 2.8;
  base.decay = 0.003 + Math.random() * 0.0025;
  return base;
}

function drawGem(ctx: CanvasRenderingContext2D, p: Particle) {
  const s = p.size;
  ctx.beginPath();
  ctx.moveTo(0, -s);
  ctx.lineTo(s * 0.65, -s * 0.15);
  ctx.lineTo(s * 0.45, s * 0.85);
  ctx.lineTo(-s * 0.45, s * 0.85);
  ctx.lineTo(-s * 0.65, -s * 0.15);
  ctx.closePath();
  ctx.fillStyle = p.color;
  ctx.fill();

  // Facet highlight
  ctx.beginPath();
  ctx.moveTo(0, -s);
  ctx.lineTo(s * 0.65, -s * 0.15);
  ctx.lineTo(0, s * 0.1);
  ctx.closePath();
  ctx.fillStyle = p.accent;
  ctx.globalAlpha = Math.max(0, p.life) * 0.55;
  ctx.fill();

  // Soft glint
  const glint = 0.35 + 0.65 * Math.abs(Math.sin(p.twinkle));
  ctx.beginPath();
  ctx.arc(-s * 0.18, -s * 0.35, s * 0.12, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.globalAlpha = Math.max(0, p.life) * glint * 0.7;
  ctx.fill();
}

function drawSparkle(ctx: CanvasRenderingContext2D, p: Particle) {
  const s = p.size;
  const pulse = 0.55 + 0.45 * Math.abs(Math.sin(p.twinkle));
  ctx.globalAlpha = Math.max(0, p.life) * pulse;
  ctx.strokeStyle = p.color;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(0, -s);
  ctx.lineTo(0, s);
  ctx.moveTo(-s, 0);
  ctx.lineTo(s, 0);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-s * 0.65, -s * 0.65);
  ctx.lineTo(s * 0.65, s * 0.65);
  ctx.moveTo(s * 0.65, -s * 0.65);
  ctx.lineTo(-s * 0.65, s * 0.65);
  ctx.stroke();
}

function drawConfetti(ctx: CanvasRenderingContext2D, p: Particle) {
  ctx.fillStyle = p.color;
  ctx.fillRect(-p.size / 2, -p.size * 0.35, p.size, p.size * 0.7);
}

function drawRibbon(ctx: CanvasRenderingContext2D, p: Particle) {
  ctx.fillStyle = p.color;
  ctx.beginPath();
  ctx.ellipse(0, 0, p.size * 0.55, p.size * 0.14, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawParticle(ctx: CanvasRenderingContext2D, p: Particle) {
  if (p.life <= 0) return;
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
  ctx.translate(p.x, p.y);
  ctx.rotate(p.rotation);
  switch (p.kind) {
    case "gem":
      drawGem(ctx, p);
      break;
    case "sparkle":
      drawSparkle(ctx, p);
      break;
    case "ribbon":
      drawRibbon(ctx, p);
      break;
    default:
      drawConfetti(ctx, p);
  }
  ctx.restore();
}

function spawnBurst(
  particles: Particle[],
  originX: number,
  originY: number,
  count: number,
  options?: { gemHeavy?: boolean; speedScale?: number }
) {
  const gemHeavy = options?.gemHeavy ?? false;
  for (let i = 0; i < count; i++) {
    const roll = Math.random();
    let kind: ParticleKind;
    if (gemHeavy) {
      kind = roll < 0.38 ? "gem" : roll < 0.62 ? "sparkle" : roll < 0.82 ? "confetti" : "ribbon";
    } else {
      kind = roll < 0.22 ? "gem" : roll < 0.42 ? "sparkle" : roll < 0.78 ? "confetti" : "ribbon";
    }
    particles.push(
      makeBurstParticle(originX, originY, kind, {
        speedScale: options?.speedScale ?? 1,
        upwardBias: 3.2 + Math.random() * 2,
      })
    );
  }
}

function spawnFalling(particles: Particle[], width: number, count: number) {
  for (let i = 0; i < count; i++) {
    const roll = Math.random();
    const kind: ParticleKind =
      roll < 0.3 ? "gem" : roll < 0.55 ? "sparkle" : roll < 0.85 ? "confetti" : "ribbon";
    particles.push(makeFaller(width, kind));
  }
}

export type CelebrationHandle = {
  stop: () => void;
};

/**
 * Runs a ~3.5s multi-wave celebration on a full-viewport canvas.
 * Particles are pointer-events-none via CSS on the canvas element.
 */
export function runCelebration(canvas: HTMLCanvasElement): CelebrationHandle {
  const ctx = canvas.getContext("2d");
  if (!ctx) return { stop: () => {} };

  if (prefersReducedMotion()) {
    return { stop: () => {} };
  }

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const resize = () => {
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();

  const w = () => window.innerWidth;
  const h = () => window.innerHeight;
  const particles: Particle[] = [];
  const isMobile = w() < 640;
  const density = isMobile ? 0.72 : 1;

  // Wave 1 — multi-origin opening bursts
  spawnBurst(particles, w() * 0.5, h() * 0.32, Math.round(90 * density), { gemHeavy: true });
  spawnBurst(particles, w() * 0.08, h() * 0.12, Math.round(55 * density));
  spawnBurst(particles, w() * 0.92, h() * 0.12, Math.round(55 * density));
  spawnBurst(particles, w() * 0.18, h() * 0.55, Math.round(40 * density), { speedScale: 0.85 });
  spawnBurst(particles, w() * 0.82, h() * 0.55, Math.round(40 * density), { speedScale: 0.85 });
  spawnFalling(particles, w(), Math.round(50 * density));

  let frame = 0;
  let raf = 0;
  let wave2Fired = false;
  let wave3Fired = false;
  const totalFrames = 220; // ~3.6s at 60fps

  const tick = () => {
    frame += 1;
    const width = w();
    const height = h();
    ctx.clearRect(0, 0, width, height);

    // Second wave as the dialog settles (~400ms)
    if (!wave2Fired && frame >= 24) {
      wave2Fired = true;
      spawnBurst(particles, width * 0.5, height * 0.42, Math.round(70 * density), {
        gemHeavy: true,
        speedScale: 1.05,
      });
      spawnBurst(particles, width * 0.25, height * 0.2, Math.round(35 * density));
      spawnBurst(particles, width * 0.75, height * 0.2, Math.round(35 * density));
      spawnFalling(particles, width, Math.round(35 * density));
    }

    // Soft late rain of gems across the viewport
    if (!wave3Fired && frame >= 70) {
      wave3Fired = true;
      spawnFalling(particles, width, Math.round(45 * density));
      spawnBurst(particles, width * 0.12, height * 0.08, Math.round(28 * density), {
        speedScale: 0.7,
      });
      spawnBurst(particles, width * 0.88, height * 0.08, Math.round(28 * density), {
        speedScale: 0.7,
      });
    }

    // Occasional late sparkles raining in
    if (frame > 40 && frame < 160 && frame % 8 === 0) {
      spawnFalling(particles, width, isMobile ? 2 : 3);
    }

    for (const p of particles) {
      if (p.life <= 0) continue;
      p.wobble += p.wobbleSpeed;
      p.twinkle += 0.12;
      p.vy += p.kind === "sparkle" ? 0.08 : 0.16;
      p.vx += Math.sin(p.wobble) * 0.045;
      p.vx *= 0.992;
      p.x += p.vx;
      p.y += p.vy;
      p.rotation += p.spin;
      p.life -= p.decay;
      drawParticle(ctx, p);
    }

    if (frame < totalFrames) {
      raf = window.requestAnimationFrame(tick);
    } else {
      ctx.clearRect(0, 0, width, height);
    }
  };

  raf = window.requestAnimationFrame(tick);

  const onResize = () => resize();
  window.addEventListener("resize", onResize);

  return {
    stop: () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    },
  };
}
