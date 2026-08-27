"use client";

import { AlertTriangle, Check, HelpCircle } from "lucide-react";

import { clashChip, type Verdict } from "@/lib/dish/clash";
import type { LikelyAllergen } from "@/lib/dish/types";

/**
 * The one-glance answer.
 *
 * Whether a dish is a problem is the question people open this app holding a
 * menu to answer, so it gets a shape and a colour of its own and appears in
 * exactly the same form everywhere. Three states and a fourth that is
 * deliberately not green: an empty profile earns "not set", not a tick.
 */

const STYLE: Record<Verdict, { chip: string; dot: string }> = {
  clash: { chip: "bg-alert-wash text-alert", dot: "bg-alert" },
  maybe: { chip: "bg-caution-wash text-caution", dot: "bg-caution" },
  clear: { chip: "bg-safe-wash text-safe", dot: "bg-safe" },
  unknown: { chip: "bg-sunk text-ink-2", dot: "bg-ink-3" },
};

interface VerdictPillProps {
  verdict: Verdict;
  clashes: readonly LikelyAllergen[];
  /** `full` spells it out; `compact` fits a list row. */
  size?: "full" | "compact";
  /**
   * Why it is unknown, when it is. A dish nobody recognised and an empty
   * profile are both "unknown" and want completely different words.
   */
  unknownReason?: "no_profile" | "unrecognised";
}

export function VerdictPill({
  verdict,
  clashes,
  size = "full",
  unknownReason = "no_profile",
}: VerdictPillProps) {
  const style = STYLE[verdict];

  const label =
    verdict === "clash"
      ? size === "compact"
        ? clashChip(clashes)
        : `Usually has ${clashChip(clashes)}`
      : verdict === "maybe"
        ? size === "compact"
          ? `maybe ${clashChip(clashes)}`
          : `Sometimes has ${clashChip(clashes)}`
        : verdict === "clear"
          ? size === "compact"
            ? "no clash"
            : "Nothing you avoid"
          : unknownReason === "unrecognised"
            ? size === "compact"
              ? "not known"
              : "Not a dish I know"
            : size === "compact"
              ? "allergies not set"
              : "Allergies not set";

  const Icon =
    verdict === "clash" || verdict === "maybe"
      ? AlertTriangle
      : verdict === "clear"
        ? Check
        : HelpCircle;

  return (
    <span
      className={[
        "inline-flex items-center gap-1.5 rounded-full font-semibold",
        style.chip,
        size === "full"
          ? "px-3 py-1.5 text-[13px]"
          : "px-2 py-0.5 text-[11px]",
      ].join(" ")}
    >
      <Icon
        className={size === "full" ? "size-3.5" : "size-3"}
        strokeWidth={2.5}
        aria-hidden
      />
      {label}
    </span>
  );
}
