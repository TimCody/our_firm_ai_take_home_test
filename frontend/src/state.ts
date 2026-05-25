/**
 * Tiny observable store. Vanilla TS, no framework.
 *
 * Each `Store<T>` holds a value and a Set of listeners. `update()` replaces
 * the value and notifies. That's the entire state model for this app —
 * enough for a multi-doc gallery without dragging in a state library.
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
    for (const fn of this.listeners) fn(this.value);
  }

  update(producer: (current: T) => T): void {
    this.set(producer(this.value));
  }

  subscribe(fn: Listener<T>): () => void {
    this.listeners.add(fn);
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
    if (raw === "demo" || raw === "mvp" || raw === "department" || raw === "enterprise") {
      return raw;
    }
  } catch {
    // ignore — localStorage can throw in private mode
  }
  return DEFAULT_PRESET_ID;
}

export function savePresetId(id: PresetId): void {
  try {
    localStorage.setItem(PRESET_KEY, id);
  } catch {
    // silent — private mode is fine
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
