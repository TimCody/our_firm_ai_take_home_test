/**
 * Tiny observable store. Vanilla TS, no framework.
 *
 * Each `Store<T>` holds a value and a Set of listeners. Calling `set`
 * or `update` replaces the value and notifies every subscriber.
 *
 * That's the entire state model for this app. It's enough for a
 * multi-doc gallery without dragging in a real state library.
 */
type Listener<T> = (value: T) => void;

export class Store<T> {
  private value: T;
  private listeners = new Set<Listener<T>>();

  constructor(initial: T) {
    this.value = initial;
  }

  get(): T {
    return this.value;
  }

  set(next: T): void {
    this.value = next;
    for (const fn of this.listeners) {
      fn(this.value);
    }
  }

  /** Apply a producer-style update. */
  update(producer: (current: T) => T): void {
    this.set(producer(this.value));
  }

  subscribe(fn: Listener<T>): () => void {
    this.listeners.add(fn);
    // Call the listener immediately with the current value so it can
    // render once on mount without needing a separate first call.
    fn(this.value);
    return () => this.listeners.delete(fn);
  }
}

import type { DocState } from "./types.js";
import { DEFAULT_PRESET_ID, type PresetId } from "./presets.js";

const PRESET_KEY = "doc-extractor.preset";

export function loadPresetId(): PresetId {
  try {
    const raw = localStorage.getItem(PRESET_KEY);
    if (
      raw === "demo" ||
      raw === "mvp" ||
      raw === "department" ||
      raw === "enterprise"
    ) {
      return raw;
    }
  } catch {
    // localStorage can throw in private mode. Just fall through.
  }
  return DEFAULT_PRESET_ID;
}

export function savePresetId(id: PresetId): void {
  try {
    localStorage.setItem(PRESET_KEY, id);
  } catch {
    // Same private-mode caveat as loadPresetId. Silent ignore is fine.
  }
}

export interface AppState {
  docs: DocState[];
  activeId: string | null;
  presetId: PresetId;
  aiAvailable: boolean;
}

export function createInitialState(): AppState {
  return {
    docs: [],
    activeId: null,
    presetId: loadPresetId(),
    aiAvailable: false,
  };
}
