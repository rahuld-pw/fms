"use client";
import { useSyncExternalStore } from "react";

// One shared clock for relative dates (overdue, due soon, timelines). Ticks every
// minute so components stay pure: they read "now" instead of calling Date.now().
let now = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(cb: () => void) {
  listeners.add(cb);
  if (!timer) {
    timer = setInterval(() => {
      now = Date.now();
      for (const l of listeners) l();
    }, 60_000);
  }
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

export function useNow() {
  return useSyncExternalStore(subscribe, () => now, () => now);
}
