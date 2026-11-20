<script lang="ts">
  import MdIcon from "$/components/basic/MdIcon.svelte";
  import { recentPrints } from "$/stores/app";
  import type { ExportedLabelTemplate } from "$/types";
  import { tr } from "$/utils/i18n";
  import { recentPrintName } from "$/utils/recent_prints";
  import { FileUtils } from "$/utils/file_utils";

  interface Props {
    /** Loads the label right away, without asking. */
    onLoad: (label: ExportedLabelTemplate) => void;
    /** Loads the label and goes straight to printing it. */
    onPrint?: (label: ExportedLabelTemplate) => void;
  }

  let { onLoad, onPrint }: Props = $props();

  /** Sharp pictures already drawn, by label and pixel height. */
  const sharp = new WeakMap<ExportedLabelTemplate, { height: number; src: string }>();
  /** Draw one at a time so scrolling stays smooth. */
  let queue: Promise<unknown> = Promise.resolve();

  /**
   * The stored thumbnail is small to save space. Once a tile is on screen, redraw the label
   * at the screen's real pixel size and swap it in.
   */
  const sharpen = (img: HTMLImageElement, item: ExportedLabelTemplate) => {
    let current = item;
    const swap = () => {
      const height = Math.ceil(img.clientHeight * window.devicePixelRatio);
      if (height === 0) return;
      const done = sharp.get(current);
      if (done && done.height >= height) {
        img.src = done.src;
        return;
      }
      const tpl = current;
      queue = queue
        .then(() => FileUtils.renderLabelPicture(tpl, height, "png"))
        .then((src) => {
          sharp.set(tpl, { height, src });
          if (tpl === current) img.src = src;
        })
        .catch((e) => console.error("Sharp history picture failed:", e));
    };
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      observer.disconnect();
      if (img.complete) swap();
      else img.addEventListener("load", swap, { once: true });
    });
    observer.observe(img);
    return {
      update(next: ExportedLabelTemplate) {
        current = next;
        img.src = sharp.get(next)?.src ?? next.thumbnailBase64 ?? "";
        observer.observe(img);
      },
      destroy: () => observer.disconnect(),
    };
  };
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
        <div class="recent-row">
          <button class="btn btn-outline-secondary recent-item p-1" title={name} onclick={() => onLoad(item)}>
            {#if item.thumbnailBase64}
              <img src={sharp.get(item)?.src ?? item.thumbnailBase64} alt={name} use:sharpen={item} />
            {:else}
              <span class="recent-name">{name}</span>
            {/if}
          </button>
          {#if onPrint}
            <button
              class="btn btn-primary reprint"
              title={$tr("editor.recent_prints.reprint")}
              aria-label={$tr("editor.recent_prints.reprint")}
              onclick={() => onPrint(item)}>
              <MdIcon icon="print" />
            </button>
          {/if}
        </div>
      {/each}
    </div>
  </div>
{/if}

<style>
  /* One column under the buttons, a little narrower than the screen. */
  .recent-prints {
    width: 81%;
    max-width: 340px;
  }

  /* Its own scroll area: swipe up and down without moving the page. */
  .recent-list {
    max-height: 45vh;
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-width: thin;
  }

  /* The label fills the row; the print button sits on its right edge. */
  .recent-row {
    position: relative;
  }

  .reprint {
    position: absolute;
    right: 8px;
    bottom: 8px;
    width: 44px;
    height: 44px;
    padding: 0;
    border-radius: 50%;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
  }

  .recent-item {
    width: 100%;
    line-height: 0;
    background: var(--app-surface-1);
    border-radius: var(--bs-border-radius-lg);
  }

  /* Wide labels fill the width; tall labels stop at this height. */
  .recent-item img {
    max-width: 100%;
    max-height: 91px;
    border-radius: 6px;
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
