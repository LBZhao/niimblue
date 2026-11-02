<script lang="ts">
  import type { LabelPreset, LabelShape } from "$/types";
  import { tr } from "$/utils/i18n";
  import MdIcon from "$/components/basic/MdIcon.svelte";

  interface Props {
    onItemSelected: (index: number) => void;
    onItemDelete: (index: number) => void;
    presets: LabelPreset[];
    class?: string;
  }

  type Piece = { x: number; y: number; width: number; height: number; shape: LabelShape };
  type Outline = {
    width: number;
    height: number;
    pieces: Piece[];
    tail?: { x: number; y: number; width: number; height: number };
    radius: number;
    edge: { x1: number; y1: number; x2: number; y2: number };
  };

  let { class: className = "", onItemDelete, onItemSelected, presets }: Props = $props();
  let deleteIndex = $state<number>(-1);

  /** Same corner radius as the editor (10 px), in the preset's unit. */
  const cornerRadius = (preset: LabelPreset): number => (preset.unit === "mm" ? 10 / preset.dpmm : 10);

  /** The label drawn in its own units: pieces, gap and tail, like the editor background. */
  const outline = (preset: LabelPreset): Outline => {
    const { width, height } = preset;
    const tail = preset.tailLength ?? 0;
    const tailPos = preset.tailPos ?? "right";
    let [startX, startY, endX, endY] = [0, 0, width, height];
    if (tail > 0) {
      if (tailPos === "right") endX -= tail;
      else if (tailPos === "bottom") endY -= tail;
      else if (tailPos === "left") startX += tail;
      else startY += tail;
    }
    const bodyW = endX - startX;
    const bodyH = endY - startY;
    const shape = preset.shape ?? "rect";
    const split = preset.split ?? "none";
    const pieces: Piece[] = [];

    if (split === "none") {
      pieces.push({ x: startX, y: startY, width: bodyW, height: bodyH, shape });
    } else if (preset.splitSizeA !== undefined && preset.splitSizeB !== undefined) {
      const shapeA = preset.shapeA ?? shape;
      const shapeB = preset.shapeB ?? shape;
      if (split === "vertical") {
        pieces.push({ x: startX, y: startY, width: preset.splitSizeA, height: bodyH, shape: shapeA });
        pieces.push({ x: endX - preset.splitSizeB, y: startY, width: preset.splitSizeB, height: bodyH, shape: shapeB });
      } else {
        pieces.push({ x: startX, y: startY, width: bodyW, height: preset.splitSizeA, shape: shapeA });
        pieces.push({ x: startX, y: endY - preset.splitSizeB, width: bodyW, height: preset.splitSizeB, shape: shapeB });
      }
    } else {
      // Older presets: equal slices.
      const parts = Math.max(1, preset.splitParts ?? 2);
      for (let i = 0; i < parts; i++) {
        pieces.push(
          split === "vertical"
            ? { x: startX + (bodyW / parts) * i, y: startY, width: bodyW / parts, height: bodyH, shape }
            : { x: startX, y: startY + (bodyH / parts) * i, width: bodyW, height: bodyH / parts, shape },
        );
      }
    }

    const tailWidth = Math.min(bodyW, bodyH) * 0.4;
    const tailRect =
      tail <= 0
        ? undefined
        : tailPos === "right"
          ? { x: endX, y: (height - tailWidth) / 2, width: tail, height: tailWidth }
          : tailPos === "left"
            ? { x: 0, y: (height - tailWidth) / 2, width: tail, height: tailWidth }
            : tailPos === "bottom"
              ? { x: (width - tailWidth) / 2, y: endY, width: tailWidth, height: tail }
              : { x: (width - tailWidth) / 2, y: 0, width: tailWidth, height: tail };

    const edge =
      preset.printDirection === "left"
        ? { x1: startX, y1: startY, x2: startX, y2: endY }
        : { x1: startX, y1: startY, x2: endX, y2: startY };

    return { width, height, pieces, tail: tailRect, radius: cornerRadius(preset), edge };
  };

  const presetName = (preset: LabelPreset): string => {
    if (preset.title) return preset.title;
    const unit = preset.unit === "mm" ? $tr("params.label.mm") : $tr("params.label.px");
    return `${preset.width}×${preset.height} ${unit}`;
  };

  /** Shown under untitled presets, since the size alone does not say which printer it is for. */
  const presetDpi = (preset: LabelPreset): string => (preset.title ? "" : `${Math.round(preset.dpmm * 25.4)} dpi`);

  const deleteConfirmed = (e: MouseEvent, idx: number) => {
    e.stopPropagation();
    deleteIndex = -1;
    onItemDelete(idx);
  };

  const deleteRejected = (e: MouseEvent) => {
    e.stopPropagation();
    deleteIndex = -1;
  };

  const deleteRequested = (e: MouseEvent, idx: number) => {
    e.stopPropagation();
    deleteIndex = idx;
  };
</script>

<div class="preset-browser overflow-y-auto border d-flex p-2 gap-2 flex-wrap {className}">
  {#each presets as item, idx (idx)}
    {@const o = outline(item)}
    <div
      role="button"
      class="preset-tile btn btn-outline-secondary p-1 d-flex flex-column align-items-center"
      tabindex="0"
      title={presetName(item)}
      onkeydown={() => onItemSelected(idx)}
      onclick={() => onItemSelected(idx)}>
      <svg class="preset-shape" viewBox="0 0 {o.width} {o.height}" preserveAspectRatio="xMidYMid meet">
        {#if o.tail}
          <rect x={o.tail.x} y={o.tail.y} width={o.tail.width} height={o.tail.height} class="tail" />
        {/if}
        {#each o.pieces as p, pIdx (pIdx)}
          {#if p.shape === "circle"}
            <circle
              cx={p.x + p.width / 2}
              cy={p.y + p.height / 2}
              r={Math.min(p.width, p.height) / 2}
              class="piece" />
          {:else}
            {@const r = p.shape === "rounded_rect" ? Math.min(o.radius, p.width / 2, p.height / 2) : 0}
            <rect x={p.x} y={p.y} width={p.width} height={p.height} rx={r} ry={r} class="piece" />
          {/if}
        {/each}
        <line x1={o.edge.x1} y1={o.edge.y1} x2={o.edge.x2} y2={o.edge.y2} class="print-edge" />
      </svg>

      <span class="preset-name">{presetName(item)}</span>
      {#if presetDpi(item)}
        <span class="preset-dpi">{presetDpi(item)}</span>
      {/if}

      <div class="remove d-flex">
        {#if deleteIndex === idx}
          <button class="btn text-danger-emphasis" onclick={(e) => deleteConfirmed(e, idx)}>
            <MdIcon icon="delete" />
          </button>
          <button class="btn text-success" onclick={(e) => deleteRejected(e)}>
            <MdIcon icon="close" />
          </button>
        {:else}
          <button class="btn text-secondary" onclick={(e) => deleteRequested(e, idx)}>
            <MdIcon icon="close" />
          </button>
        {/if}
      </div>
    </div>
  {/each}
</div>

<style>
  .preset-browser {
    max-height: 240px;
    max-width: 100%;
    min-height: 96px;
  }

  .preset-tile {
    position: relative;
    width: 112px;
    gap: 2px;
  }

  .preset-shape {
    width: 96px;
    height: 48px;
    margin-top: 10px;
    overflow: visible;
  }

  .piece {
    fill: white;
  }

  .tail {
    fill: #cfcfcf;
  }

  .print-edge {
    stroke: #ff4646;
    stroke-width: 3px;
    vector-effect: non-scaling-stroke;
  }

  .preset-name {
    font-size: 0.75rem;
    line-height: 1.15;
    max-width: 100%;
    overflow-wrap: anywhere;
  }

  .preset-dpi {
    font-size: 0.65rem;
    line-height: 1;
    opacity: 0.7;
  }

  .remove {
    position: absolute;
    top: 0;
    right: 0;
  }

  .remove > button {
    padding: 0 2px;
    line-height: 100%;
    font-size: 0.85rem;
  }
</style>
