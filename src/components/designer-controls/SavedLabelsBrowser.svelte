<script lang="ts">
  import type { ExportedLabelTemplate } from "$/types";
  import { tr } from "$/utils/i18n";
  import MdIcon from "$/components/basic/MdIcon.svelte";
  import { recentPrintName } from "$/utils/recent_prints";
  import { Capacitor } from "@capacitor/core";

  interface Props {
    onItemClicked: (index: number) => void;
    onItemDelete: (index: number) => void;
    onItemExport: (index: number) => void;
    labels: ExportedLabelTemplate[];
    selectedIndex?: number;
    class?: string;
  }

  let { onItemClicked, onItemDelete, onItemExport, labels, selectedIndex = -1, class: className }: Props = $props();

  /** Edit mode shows large export and delete buttons and stops taps from selecting. */
  let editing = $state<boolean>(false);

  /** In the app the export writes to the phone; in a browser it downloads. */
  const onPhone = Capacitor.getPlatform() !== "web";

  const onTileClick = (idx: number) => {
    if (editing) return;
    onItemClicked(idx);
  };

  const deleteClicked = (e: MouseEvent, idx: number) => {
    e.stopPropagation();
    const name = recentPrintName(labels[idx]);
    if (!confirm($tr("params.saved_labels.delete.confirm").replace("{name}", name))) return;
    onItemDelete(idx);
    if (labels.length <= 1) editing = false;
  };

  const exportClicked = (e: MouseEvent, idx: number) => {
    e.stopPropagation();
    onItemExport(idx);
  };

  const toggleEditing = (e: MouseEvent) => {
    // Keep the save/load dropdown open.
    e.stopPropagation();
    editing = !editing;
  };
</script>

<div class="labels-browser border {className}">
  {#if labels.length > 0}
    <div class="d-flex justify-content-end px-2 pt-2">
      <button class="btn btn-sm {editing ? 'btn-primary' : 'btn-outline-secondary'}" onclick={toggleEditing}>
        <MdIcon icon={editing ? "check" : "edit"} />
        {editing ? $tr("params.saved_labels.done") : $tr("params.saved_labels.edit")}
      </button>
    </div>
  {/if}
  <div class="labels-list overflow-y-auto p-2">
    {#each labels as item, idx (item.id ?? item.timestamp)}
      {@const name = recentPrintName(item)}
      <div
        tabindex="0"
        role="button"
        class="label-tile btn btn-outline-secondary p-1 d-flex flex-column align-items-center"
        class:selected={selectedIndex === idx}
        class:editing
        title={name}
        onkeydown={() => onTileClick(idx)}
        onclick={() => onTileClick(idx)}>
        <div class="thumb d-flex align-items-center justify-content-center">
          {#if item.thumbnailBase64}
            <img src={item.thumbnailBase64} alt={name} />
          {/if}
        </div>
        <span class="label-name">{name}</span>

        {#if editing}
          <div class="tile-actions d-flex gap-2">
            <button
              class="btn btn-primary"
              title={onPhone ? $tr("params.saved_labels.save_to_phone") : $tr("params.saved_labels.download")}
              aria-label={onPhone ? $tr("params.saved_labels.save_to_phone") : $tr("params.saved_labels.download")}
              onclick={(e) => exportClicked(e, idx)}>
              <MdIcon icon={onPhone ? "save_alt" : "download"} />
            </button>
            <button
              class="btn btn-danger"
              title={$tr("params.saved_labels.delete")}
              aria-label={$tr("params.saved_labels.delete")}
              onclick={(e) => deleteClicked(e, idx)}>
              <MdIcon icon="delete" />
            </button>
          </div>
        {/if}
      </div>
    {/each}
  </div>
</div>

<style>
  .labels-browser {
    max-width: 100%;
  }

  /* Two columns that share the box width, like the label presets. */
  .labels-list {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.5rem;
    max-height: 320px;
    min-height: 96px;
  }

  .label-tile {
    position: relative;
    min-width: 0;
    gap: 2px;
  }

  .label-tile.selected {
    border-color: var(--bs-primary);
    box-shadow: 0 0 0 2px var(--bs-primary);
  }

  .label-tile.editing {
    cursor: default;
  }

  .thumb {
    width: 100%;
    height: 72px;
  }

  .thumb img {
    max-width: 100%;
    max-height: 72px;
    border-radius: 2px;
  }

  .label-name {
    font-size: 0.8rem;
    line-height: 1.15;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* At least 44 px so they are easy to hit on a phone. Sit on the thumbnail so the name stays readable. */
  .tile-actions {
    position: absolute;
    top: 40px;
    left: 50%;
    transform: translate(-50%, -50%);
  }

  .tile-actions > button {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    padding: 0;
    font-size: 1.4rem;
    line-height: 1;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.5);
  }
</style>
