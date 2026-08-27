import { useState } from "react";

import { DISHES } from "./dishes";

/**
 * The one screen this build has that the real app does not.
 *
 * It exists because the home screen promises to read a menu you photograph,
 * and this copy cannot do that. Saying so before somebody points a camera at
 * their dinner is the whole job. It also names a few dishes to type, since a
 * fixed list is only useful if you know roughly what is in it.
 *
 * Styled from the app's own custom properties rather than its utility classes:
 * the stylesheet is whatever Tailwind emitted for the app, and a class the app
 * never used is not in it.
 */

const SUGGESTIONS = [
  "pad thai",
  "bún chả",
  "khachapuri",
  "okonomiyaki",
  "mole",
  "tteokbokki",
  "hummus",
  "pierogi",
];

const SEEN_KEY = "tastebuddy.demo-intro.v1";

function alreadySeen(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === "yes";
  } catch {
    return false;
  }
}

export function Intro() {
  const [open, setOpen] = useState(() => !alreadySeen());

  if (!open) return null;

  const close = () => {
    try {
      window.localStorage.setItem(SEEN_KEY, "yes");
    } catch {
      /* Private mode. It will show again; that is the harmless direction. */
    }
    setOpen(false);
  };

  return (
    <div className="demo-scrim" role="dialog" aria-modal="true" aria-labelledby="demo-title">
      <div className="demo-sheet">
        <p className="demo-eyebrow">Demo copy</p>
        <h2 id="demo-title" className="demo-title">
          This one cannot read your menu.
        </h2>
        <p className="demo-body">
          A page like this is not allowed to reach the internet, so there is
          nothing for it to ask. It answers from {DISHES.length} dishes built
          into the file, and the camera button opens a fixed sample menu instead
          of reading your photo.
        </p>
        <p className="demo-body">Everything else is the real app: your allergy
          list, the matching, the warnings, the dish on the plate.</p>

        <p className="demo-label">Dishes it knows</p>
        <ul className="demo-chips">
          {SUGGESTIONS.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>

        <button type="button" className="demo-go" onClick={close}>
          Start
        </button>
      </div>
    </div>
  );
}
