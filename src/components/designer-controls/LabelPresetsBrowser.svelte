<script lang="ts">
  import type { LabelPreset, LabelShape } from "$/types";
  import { tr } from "$/utils/i18n";
  import MdIcon from "$/components/basic/MdIcon.svelte";
  import { LABEL_CORNER_RADIUS_MM } from "$/defaults";

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
  };

  let { class: className = "", onItemDelete, onItemSelected, presets }: Props = $props();
  /** Edit mode shows a large delete button on each tile and stops taps from applying presets. */
  let editing = $state<boolean>(false);

  /** Same corner radius as the editor, in the preset's unit. */
  const cornerRadius = (preset: LabelPreset): number =>
    preset.unit === "mm" ? LABEL_CORNER_RADIUS_MM : LABEL_CORNER_RADIUS_MM * preset.dpmm;

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

return { width, height, pieces, tail: tailRect, radius: cornerRadius(preset) };
  };

  const presetName = (preset: LabelPreset): string => {
    if (preset.title) return preset.title;
    const unit = preset.unit === "mm" ? $tr("params.label.mm") : $tr("params.label.px");
    return `${preset.width}×${preset.height} ${unit}`;
  };

  /** Shown under untitled presets, since the size alone does not say which printer it is for. */
  const presetDpi = (preset: LabelPreset): string => (preset.title ? "" : `${Math.round(preset.dpmm * 25.4)} dpi`);

  const onTileClick = (idx: number) => {
    if (editing) return;
    onItemSelected(idx);
  };

  const deleteClicked = (e: MouseEvent, idx: number) => {
    e.stopPropagation();
    const name = presetName(presets[idx]);
    if (!confirm($tr("params.label.presets.delete.confirm").replace("{name}", name))) return;
    onItemDelete(idx);
    if (presets.length <= 1) editing = false;
  };

  const toggleEditing = (e: MouseEvent) => {
    // Keep the label properties dropdown open.
    e.stopPropagation();
    editing = !editing;
  };
</script>

<div class="preset-browser border {className}">
  {#if presets.length > 0}
    <div class="d-flex justify-content-end px-2 pt-2">
      <button class="btn btn-sm {editing ? 'btn-primary' : 'btn-outline-secondary'}" onclick={toggleEditing}>
        <MdIcon icon={editing ? "check" : "edit"} />
        {editing ? $tr("params.label.presets.done") : $tr("params.label.presets.edit")}
      </button>
    </div>
  {/if}
  <div class="preset-list overflow-y-auto p-2">
    {#each presets as item, idx (idx)}
      {@const o = outline(item)}
      <div
        role="button"
        class="preset-tile btn btn-outline-secondary p-1 d-flex flex-column align-items-center"
        class:editing
        tabindex="0"
        title={presetName(item)}
        onkeydown={() => onTileClick(idx)}
        onclick={() => onTileClick(idx)}>
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
        </svg>
        <!-- Points into the edge that prints first. -->
        <span class="feed-mark feed-{item.printDirection}"><MdIcon icon="arrow_downward" /></span>

        <span class="preset-name">{presetName(item)}</span>
        {#if presetDpi(item)}
          <span class="preset-dpi">{presetDpi(item)}</span>
        {/if}

        {#if editing}
          <button
            class="btn btn-danger delete-preset"
            title={$tr("params.label.presets.delete")}
            aria-label={$tr("params.label.presets.delete")}
            onclick={(e) => deleteClicked(e, idx)}>
            <MdIcon icon="delete" />
          </button>
        {/if}
      </div>
    {/each}
  </div>
</div>

<style>
  .preset-browser {
    max-width: 100%;
  }

  /* Two columns that share the box width, so tiles grow with the dialog. */
  .preset-list {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.5rem;
    max-height: 300px;
    min-height: 96px;
  }

  .preset-tile {
    position: relative;
    min-width: 0;
    gap: 2px;
  }

  .preset-shape {
    width: 100%;
    height: 64px;
    margin-top: 10px;
    overflow: visible;
  }

  .piece {
    fill: white;
  }

  .tail {
    fill: #cfcfcf;
  }

  .feed-mark {
    position: absolute;
    color: var(--bs-primary-text-emphasis);
    font-size: 0.8rem;
    line-height: 1;
  }

  .feed-mark.feed-top {
    top: 0;
    left: 50%;
    transform: translateX(-50%);
  }

  .feed-mark.feed-left {
    top: 42px;
    left: 2px;
    transform: translateY(-50%) rotate(-90deg);
  }

  .preset-name {
    font-size: 0.8rem;
    line-height: 1.15;
    max-width: 100%;
    overflow-wrap: anywhere;
  }

  .preset-dpi {
    font-size: 0.65rem;
    line-height: 1;
    opacity: 0.7;
  }

  .preset-tile.editing {
    cursor: default;
  }

  /* At least 44 px so it is easy to hit on a phone. Sits on the shape so the name stays readable. */
  .delete-preset {
    position: absolute;
    top: 42px;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 48px;
    height: 48px;
    border-radius: 50%;
    padding: 0;
    font-size: 1.4rem;
    line-height: 1;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.5);
  }
</style>
