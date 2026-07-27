import React, { useEffect, useRef, useState } from "react";
import { ArrowLeftRight, Eye } from "lucide-react";

interface CompareSliderProps {
  original: string;
  repaired: string;
  className?: string;
}

export default function CompareSlider({ original, repaired, className = "" }: CompareSliderProps) {
  const [sliderPosition, setSliderPosition] = useState(50);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMove = (clientX: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = clientX - rect.left;
    setSliderPosition(Math.max(0, Math.min(100, (x / rect.width) * 100)));
  };

  useEffect(() => {
    const stop = () => setIsDragging(false);
    window.addEventListener("mouseup", stop);
    window.addEventListener("touchend", stop);
    return () => {
      window.removeEventListener("mouseup", stop);
      window.removeEventListener("touchend", stop);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden rounded-lg border border-zinc-200 bg-zinc-950 shadow-sm ${className}`}
      onMouseMove={(event) => isDragging && handleMove(event.clientX)}
      onTouchMove={(event) => event.touches[0] && isDragging && handleMove(event.touches[0].clientX)}
      onMouseDown={() => setIsDragging(true)}
      onTouchStart={() => setIsDragging(true)}
    >
      <img src={repaired} alt="修复后" className="block h-full w-full object-cover" />

      <div className="absolute right-3 top-3 rounded bg-emerald-950/80 px-2 py-1 text-xs font-medium text-emerald-100">
        修复后
      </div>

      <div className="absolute inset-y-0 left-0 overflow-hidden border-r border-emerald-300" style={{ width: `${sliderPosition}%` }}>
        <img
          src={original}
          alt="修复前"
          className="absolute left-0 top-0 h-full max-w-none object-cover"
          style={{ width: containerRef.current?.getBoundingClientRect().width || "100%" }}
        />
        <div className="absolute left-3 top-3 rounded bg-zinc-950/80 px-2 py-1 text-xs font-medium text-rose-100">
          修复前
        </div>
      </div>

      <div className="absolute inset-y-0 z-20 w-0.5 cursor-ew-resize bg-emerald-300" style={{ left: `${sliderPosition}%` }}>
        <div className="absolute top-1/2 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-emerald-200 bg-zinc-950 text-emerald-100 shadow">
          <ArrowLeftRight className="h-4 w-4" />
        </div>
      </div>

      <div className="pointer-events-none absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-zinc-950/70 px-3 py-1 text-xs text-zinc-100">
        <Eye className="h-3.5 w-3.5" />
        拖动查看对比
      </div>
    </div>
  );
}
