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
  <div class="recent-prints">
    <div class="recent-title text-secondary small d-flex align-items-center gap-1 mb-1">
      <MdIcon icon="history" />
      {$tr("editor.recent_prints")} ({$recentPrints.length})
    </div>
    <div class="recent-list d-flex flex-column gap-1">
      {#each $recentPrints as item, idx (idx)}
        {@const name = recentPrintName(item)}
        <button class="btn btn-outline-secondary recent-item p-1" title={name} onclick={() => onLoad(item)}>
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
  /* One column under the buttons, a little narrower than the screen. */
  .recent-prints {
    width: 90%;
    max-width: 378px;
  }

  /* Its own scroll area: swipe up and down without moving the page. */
  .recent-list {
    max-height: 45vh;
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-width: thin;
  }

  .recent-item {
    width: 100%;
    line-height: 0;
  }

  /* Wide labels fill the width; tall labels stop at this height. */
  .recent-item img {
    max-width: 100%;
    max-height: 101px;
    border-radius: 2px;
  }

  .recent-name {
    display: inline-block;
    line-height: 48px;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
