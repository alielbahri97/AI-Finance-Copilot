"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { PartyPopperIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Props = {
  /** Called after the dialog is dismissed so sibling prompts can continue. */
  onDone: () => void;
};

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  size: number;
  rotation: number;
  spin: number;
  life: number;
};

const COLORS = ["#0f766e", "#14b8a6", "#f59e0b", "#ef4444", "#3b82f6", "#a855f7", "#ec4899"];

function burst(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return () => {};

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const resize = () => {
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();

  const originX = window.innerWidth / 2;
  const originY = window.innerHeight * 0.28;
  const particles: Particle[] = Array.from({ length: 140 }, () => {
    const angle = Math.random() * Math.PI * 2;
    const speed = 4 + Math.random() * 9;
    return {
      x: originX,
      y: originY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 4,
      color: COLORS[Math.floor(Math.random() * COLORS.length)]!,
      size: 4 + Math.random() * 6,
      rotation: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 0.3,
      life: 1,
    };
  });

  let frame = 0;
  let raf = 0;
  const tick = () => {
    frame += 1;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    for (const p of particles) {
      p.vy += 0.18;
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.rotation += p.spin;
      p.life -= 0.008;
      if (p.life <= 0) continue;
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      ctx.restore();
    }
    if (frame < 160) {
      raf = window.requestAnimationFrame(tick);
    } else {
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    }
  };
  raf = window.requestAnimationFrame(tick);

  const onResize = () => resize();
  window.addEventListener("resize", onResize);
  return () => {
    window.cancelAnimationFrame(raf);
    window.removeEventListener("resize", onResize);
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  };
}

/**
 * One-shot celebration for complimentary Enterprise grants.
 * Confetti + dialog; dismiss POSTs so it never returns.
 */
export function EnterprisePromo({ onDone }: Props) {
  const [open, setOpen] = useState(true);
  const [pending, startTransition] = useTransition();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    return burst(canvas);
  }, []);

  function finish() {
    startTransition(async () => {
      try {
        await fetch("/api/billing/enterprise-promo/complete", { method: "POST" });
      } catch {
        // Persistence failed — still dismiss so the user isn't trapped.
      } finally {
        setOpen(false);
        onDone();
      }
    });
  }

  return (
    <>
      <canvas
        ref={canvasRef}
        aria-hidden
        className="pointer-events-none fixed inset-0 z-[60]"
      />
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) finish();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="mb-2 flex size-12 items-center justify-center rounded-full bg-teal-500/15 text-teal-700 dark:text-teal-300">
              <PartyPopperIcon className="size-6" />
            </div>
            <DialogTitle>You&apos;re on Enterprise</DialogTitle>
            <DialogDescription>
              Admin promoted you to the Enterprise version. Enjoy unlimited access across
              Ballast — every feature, every limit unlocked.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={finish} disabled={pending}>
              Let&apos;s go
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
