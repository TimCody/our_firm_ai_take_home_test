/**
 * Architecture diagram renderer.
 *
 * Pinned to the active preset and shown below the gallery. The diagram
 * is ASCII so it's robust to font-rendering quirks, easy to copy-paste,
 * and obviously hand-drawn. That last part is the right tone: these
 * are sketches of how we'd actually build it, not auto-generated
 * cloud topology diagrams.
 */
import type { Preset } from "./presets.js";

export interface ArchitectureRefs {
  section: HTMLElement;
  title: HTMLElement;
  diagram: HTMLPreElement;
  notesList: HTMLElement;
}

export function renderArchitecture(
  refs: ArchitectureRefs,
  preset: Preset,
): void {
  refs.section.hidden = false;
  refs.title.textContent = preset.title;
  refs.diagram.textContent = preset.diagram;

  refs.notesList.innerHTML = "";
  for (const note of preset.notes) {
    const li = document.createElement("li");
    li.textContent = note;
    refs.notesList.appendChild(li);
  }
}
