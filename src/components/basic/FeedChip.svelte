<script lang="ts">
  import type { PrintDirection } from "@mmote/niimbluelib";
  import MdIcon from "$/components/basic/MdIcon.svelte";
  import { tr } from "$/utils/i18n";

  interface Props {
    /** "top": the chip sits above the label. "left": beside it, reading upwards. */
    direction: PrintDirection;
  }

  let { direction }: Props = $props();
</script>

<!-- Marks the edge of the label that goes through the printer first. -->
<div class="feed-chip feed-{direction}" title={$tr("editor.print_starts")}>
  <MdIcon icon="arrow_downward" />
  <span>{$tr("editor.print_starts")}</span>
</div>

<style>
  .feed-chip {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 1px 8px 1px 4px;
    border-radius: 999px;
    background: var(--bs-primary-bg-subtle);
    color: var(--bs-primary-text-emphasis);
    font-size: 0.75rem;
    line-height: 1.4;
    white-space: nowrap;
    user-select: none;
  }

  /* Vertical, reading bottom to top; the arrow then points right, into the label. */
  .feed-chip.feed-left {
    writing-mode: vertical-rl;
    transform: rotate(180deg);
    padding: 8px 1px 4px 1px;
  }
</style>
