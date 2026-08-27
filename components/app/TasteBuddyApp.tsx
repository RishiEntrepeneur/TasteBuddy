"use client";

import { AlertTriangle, Camera, Home, Loader2, ShieldCheck } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { AllergyScreen } from "@/components/app/AllergyScreen";
import { DishScreen } from "@/components/app/DishScreen";
import { HomeScreen } from "@/components/app/HomeScreen";
import {
  MenuResults,
  type MenuReadingView,
} from "@/components/app/MenuResults";
import { TasteBuddyARViewer, arDishFrom } from "@/components/TasteBuddyARViewer";
import { clashesWith } from "@/lib/dish/clash";
import type { DishExplanation, DishSummary } from "@/lib/dish/types";
import { useAllergenProfile } from "@/lib/hooks/useAllergenProfile";
import { useDinerToken } from "@/lib/hooks/useDinerToken";
import { useHistory, type HistoryEntry } from "@/lib/hooks/useHistory";

/**
 * The app.
 *
 * One screen at a time with a bar along the bottom, because it is used
 * one-handed at a table. The camera is the middle of that bar and the heaviest
 * thing on the screen: everything else here exists to serve the moment
 * somebody points it at a menu.
 */

type Tab = "home" | "allergies";
type Screen =
  | { name: "tab" }
  | { name: "menu" }
  | { name: "dish"; from: "tab" | "menu"; entryId: string | null };

export function TasteBuddyApp() {
  const { profile } = useAllergenProfile();
  const { entries, remember, forget } = useHistory();
  const token = useDinerToken();

  const [tab, setTab] = useState<Tab>("home");
  const [screen, setScreen] = useState<Screen>({ name: "tab" });
  const [reading, setReading] = useState<MenuReadingView | null>(null);
  const [dish, setDish] = useState<DishExplanation | null>(null);
  const [scanning, setScanning] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [onPlate, setOnPlate] = useState(false);
  const camera = useRef<HTMLInputElement>(null);

  const avoid = profile.avoid;

  /* ---- photograph a menu ------------------------------------------------ */

  const readPhoto = useCallback(
    async (file: File) => {
      if (!token) return;
      setScanning(true);
      setError(null);
      try {
        const body = new FormData();
        body.set("token", token);
        body.set("photo", file);
        const response = await fetch("/api/read-menu", { method: "POST", body });
        const payload = (await response.json()) as MenuReadingView & {
          error?: { message?: string };
        };
        if (!response.ok) {
          throw new Error(payload.error?.message ?? "That did not work.");
        }
        setReading(payload);
        setScreen({ name: "menu" });
      } catch (err) {
        setError(err instanceof Error ? err.message : "That did not work.");
      } finally {
        setScanning(false);
      }
    },
    [token],
  );

  /* ---- one dish --------------------------------------------------------- */

  const lookUp = useCallback(
    async (name: string, context: string, from: "tab" | "menu") => {
      if (!token) return;
      setOpening(name);
      setError(null);
      try {
        const response = await fetch("/api/explain", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, name, context }),
        });
        const payload = (await response.json()) as DishExplanation & {
          error?: { message?: string };
        };
        if (!response.ok) {
          throw new Error(payload.error?.message ?? "That did not work.");
        }
        const entry = remember(payload);
        setDish(payload);
        setScreen({ name: "dish", from, entryId: entry.id });
      } catch (err) {
        setError(err instanceof Error ? err.message : "That did not work.");
      } finally {
        setOpening(null);
      }
    },
    [token, remember],
  );

  /** Re-opening from the log asks nothing of the model: it is already paid for. */
  const openRemembered = useCallback((entry: HistoryEntry) => {
    setDish(entry.dish);
    setScreen({ name: "dish", from: "tab", entryId: entry.id });
  }, []);

  /* ---- the AR view ------------------------------------------------------ */

  if (onPlate && dish) {
    return (
      <TasteBuddyARViewer
        item={arDishFrom(dish, clashesWith(dish, avoid))}
        onClose={() => setOnPlate(false)}
      />
    );
  }

  /* ---- what is on screen ------------------------------------------------ */

  const body =
    screen.name === "dish" && dish ? (
      <DishScreen
        dish={dish}
        avoid={avoid}
        onBack={() => {
          setDish(null);
          setScreen(screen.from === "menu" ? { name: "menu" } : { name: "tab" });
        }}
        onSeeOnPlate={() => setOnPlate(true)}
        onForget={
          screen.entryId
            ? () => {
                forget(screen.entryId as string);
                setDish(null);
                setScreen({ name: "tab" });
              }
            : undefined
        }
      />
    ) : screen.name === "menu" && reading ? (
      <MenuResults
        reading={reading}
        avoid={avoid}
        opening={opening}
        onOpen={(summary: DishSummary) =>
          void lookUp(
            summary.printedName,
            `${summary.englishName} ${summary.oneLine}`,
            "menu",
          )
        }
        onBack={() => {
          setReading(null);
          setScreen({ name: "tab" });
        }}
      />
    ) : tab === "allergies" ? (
      <AllergyScreen />
    ) : (
      <HomeScreen
        entries={entries}
        avoid={avoid}
        searching={opening !== null}
        onOpen={openRemembered}
        onSearch={(name) => void lookUp(name, "", "tab")}
      />
    );

  const onTab = screen.name === "tab";

  return (
    <div className="mx-auto min-h-dvh w-full max-w-lg">
      <main className="safe-top pb-32">{body}</main>

      {error ? (
        <div className="fixed inset-x-0 bottom-28 z-30 mx-auto max-w-lg px-4">
          <p
            role="alert"
            className="card flex items-start gap-2.5 border-l-4 border-alert px-4 py-3 text-[15px] leading-relaxed text-ink"
          >
            <AlertTriangle
              className="mt-0.5 size-4 shrink-0 text-alert"
              aria-hidden
            />
            <span className="min-w-0 flex-1">{error}</span>
            <button
              type="button"
              onClick={() => setError(null)}
              className="shrink-0 text-[13px] font-semibold text-ink-2"
            >
              OK
            </button>
          </p>
        </div>
      ) : null}

      {/* ---- the bar --------------------------------------------------- */}
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-20 mx-auto flex max-w-lg items-end justify-around border-t border-line bg-card/95 px-6 pt-2 backdrop-blur">
        <TabButton
          label="Home"
          icon={Home}
          active={onTab && tab === "home"}
          onClick={() => {
            setTab("home");
            setScreen({ name: "tab" });
            setDish(null);
          }}
        />

        {/* The shutter. Deliberately the heaviest thing on the screen. */}
        <button
          type="button"
          onClick={() => camera.current?.click()}
          disabled={scanning || !token}
          className="shutter -mt-7 flex size-16 shrink-0 items-center justify-center rounded-full bg-ink text-card transition active:scale-95 disabled:opacity-60"
          aria-label={scanning ? "Reading the menu" : "Photograph a menu"}
        >
          {scanning ? (
            <Loader2 className="size-7 animate-spin" aria-hidden />
          ) : (
            <Camera className="size-7" strokeWidth={1.75} aria-hidden />
          )}
        </button>

        <TabButton
          label="Allergies"
          icon={ShieldCheck}
          active={onTab && tab === "allergies"}
          badge={avoid.length || undefined}
          onClick={() => {
            setTab("allergies");
            setScreen({ name: "tab" });
            setDish(null);
          }}
        />
      </nav>

      <input
        ref={camera}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void readPhoto(file);
        }}
      />
    </div>
  );
}

interface TabButtonProps {
  label: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  active: boolean;
  badge?: number;
  onClick: () => void;
}

function TabButton({
  label,
  icon: Icon,
  active,
  badge,
  onClick,
}: TabButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={[
        "relative flex w-20 flex-col items-center gap-1 rounded-control py-2 transition",
        active ? "text-ink" : "text-ink-3",
      ].join(" ")}
    >
      <Icon className="size-5.5" aria-hidden />
      <span className="text-[11px] font-medium">{label}</span>
      {badge ? (
        <span className="absolute right-3 top-1 flex size-4 items-center justify-center rounded-full bg-safe text-[10px] font-bold text-card">
          {badge}
        </span>
      ) : null}
    </button>
  );
}
