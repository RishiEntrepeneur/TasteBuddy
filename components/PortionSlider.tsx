"use client";

import { Minus, Plus } from "lucide-react";
import { useId } from "react";

import type { PortionRange } from "@/lib/types";

interface PortionSliderProps {
  value: number;
  range: PortionRange;
  /** Grams on the plate at multiplier 1.0, used for the live gram readout. */
  basePortionGrams: number;
  onChange: (portion: number) => void;
  disabled?: boolean;
}

function formatMultiplier(value: number): string {
  // 1 -> "1x", 1.25 -> "1.25x", 0.5 -> "0.5x"
  return `${Number(value.toFixed(2))}×`;
}

/**
 * The portion control.
 *
 * A native `input[type=range]` styled in `globals.css` — it keeps keyboard and
 * screen-reader semantics for free, and the flanking step buttons give a
 * precise target for thumbs on a moving table.
 */
export function PortionSlider({
  value,
  range,
  basePortionGrams,
  onChange,
  disabled = false,
}: PortionSliderProps) {
  const id = useId();
  const grams = Math.round(basePortionGrams * value);
  const fixed = range.min === range.max;

  function step(direction: -1 | 1): void {
    const next = Number((value + direction * range.step).toFixed(4));
    onChange(Math.min(range.max, Math.max(range.min, next)));
  }

  if (fixed) {
    return (
      <p className="text-sm text-ink-muted">
        Served as {basePortionGrams} g — one size.
      </p>
    );
  }

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-sm font-medium text-ink">
          Portion
        </label>
        <span className="text-sm tabular-nums text-ink-muted">
          {formatMultiplier(value)} · {grams} g
        </span>
      </div>

      <div className="mt-1 flex items-center gap-2">
        <button
          type="button"
          onClick={() => step(-1)}
          disabled={disabled || value <= range.min}
          aria-label="Smaller portion"
          className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border text-ink transition disabled:opacity-30"
        >
          <Minus className="size-4" aria-hidden />
        </button>

        <input
          id={id}
          type="range"
          className="portion-slider flex-1"
          min={range.min}
          max={range.max}
          step={range.step}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(Number(event.target.value))}
          aria-valuetext={`${formatMultiplier(value)}, ${grams} grams`}
        />

        <button
          type="button"
          onClick={() => step(1)}
          disabled={disabled || value >= range.max}
          aria-label="Larger portion"
          className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border text-ink transition disabled:opacity-30"
        >
          <Plus className="size-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
