<script lang="ts">
  import MdIcon from "$/components/basic/MdIcon.svelte";
  import { recentPrints } from "$/stores";
  import type { ExportedLabelTemplate } from "$/types";
  import { tr } from "$/utils/i18n";
  import { recentPrintName } from "$/utils/recent_prints";

  interface Props {
    /** Loads the label right away, without asking. */
    onLoad: (label: ExportedLabelTemplate) => void;
  }

  let { onLoad }: Props = $props();
</script>

{#if $recentPrints.length > 0}
  <div class="recent-prints d-flex align-items-center gap-1" title={$tr("editor.recent_prints")}>
    <MdIcon icon="history" class="text-secondary flex-shrink-0" />
    <div class="recent-list d-flex gap-1">
      {#each $recentPrints as item, idx (idx)}
        {@const name = recentPrintName(item)}
        <button class="btn btn-sm btn-outline-secondary recent-item p-1" title={name} onclick={() => onLoad(item)}>
          {#if item.thumbnailBase64}
            <img src={item.thumbnailBase64} alt={name} />
          {:else}
            <span class="recent-name">{name}</span>
          {/if}
        </button>
      {/each}
    </div>
  </div>
{/if}

<style>
  .recent-prints {
    max-width: 100%;
  }

  .recent-list {
    overflow-x: auto;
    scrollbar-width: thin;
    padding-bottom: 2px;
  }

  .recent-item {
    flex-shrink: 0;
    line-height: 0;
  }

  .recent-item img {
    height: 40px;
    width: auto;
    border-radius: 2px;
  }

  .recent-name {
    display: inline-block;
    line-height: 40px;
    max-width: 8em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
