<script lang="ts">
  import {
    LabelPresetSchema,
    type LabelPreset,
    type LabelProps,
    type LabelShape,
    type LabelSplit,
    type LabelUnit,
    type MirrorType,
    type TailPosition,
  } from "$/types";
  import LabelPresetsBrowser from "$/components/designer-controls/LabelPresetsBrowser.svelte";
  import { printerMeta } from "$/stores";
  import { tr } from "$/utils/i18n";
  import { DEFAULT_LABEL_PRESETS } from "$/defaults";
  import { onMount, tick } from "svelte";
  import { LocalStoragePersistence } from "$/utils/persistence";
  import type { PrintDirection } from "@mmote/niimbluelib";
  import MdIcon from "$/components/basic/MdIcon.svelte";
  import { Toasts } from "$/utils/toasts";
  import { FileUtils } from "$/utils/file_utils";
  import { z } from "zod";
  import DpiSelector from "$/components/designer-controls/DpiSelector.svelte";

  interface Props {
    labelProps: LabelProps;
    onChange: (newProps: LabelProps) => void;
  }

  let { labelProps, onChange }: Props = $props();

  const tailPositions: TailPosition[] = ["right", "bottom", "left", "top"];
  const printDirections: PrintDirection[] = ["left", "top"];
  const labelShapes: LabelShape[] = ["rect", "rounded_rect", "circle"];
  const labelSplits: LabelSplit[] = ["none", "vertical", "horizontal"];
  const mirrorTypes: MirrorType[] = ["none", "flip", "copy"];

  let labelPresets = $state<LabelPreset[]>(DEFAULT_LABEL_PRESETS);

  let title = $state<string | undefined>("");
  let prevUnit: LabelUnit = "mm";
  let unit = $state<LabelUnit>("mm");
  let dpmm = $state<number>(8);
  let width = $state<number>(0);
  let height = $state<number>(0);
  let printDirection = $state<PrintDirection>("left");
  let shape = $state<LabelShape>("rect");
  let shapeA = $state<LabelShape>("rect");
  let shapeB = $state<LabelShape>("rect");
  let split = $state<LabelSplit>("none");
  let splitParts = $state<number>(2);
  let splitSizeA = $state<number>(0);
  let splitSizeB = $state<number>(0);
  let tailLength = $state<number>(0);
  let tailPos = $state<TailPosition>("right");
  let mirror = $state<MirrorType>("none");

  let error = $derived.by<string>(() => {
    let error = "";

    const headSize = labelProps.printDirection == "left" ? labelProps.size.height : labelProps.size.width;
    if ($printerMeta !== undefined) {
      if (headSize > $printerMeta.printheadPixels) {
        error += $tr("params.label.warning.width") + " ";
        error += `(${headSize} > ${$printerMeta.printheadPixels})`;
        error += "\n";
      }

      if ($printerMeta.printDirection !== labelProps.printDirection) {
        error += $tr("params.label.warning.direction") + " ";
        if ($printerMeta.printDirection == "left") {
          error += $tr("params.label.direction.left");
        } else {
          error += $tr("params.label.direction.top");
        }
      }
    }

    if (headSize % 8 !== 0) {
      error += $tr("params.label.warning.div8");
    }

    return error;
  });

  const bodyLength = (
    axis: LabelSplit,
    totalWidth: number,
    totalHeight: number,
    tail: number,
    tailPosition: TailPosition,
  ): number => {
    if (axis === "none") return 0;
    let body = axis === "vertical" ? totalWidth : totalHeight;
    const tailOnAxis =
      axis === "vertical"
        ? tailPosition === "left" || tailPosition === "right"
        : tailPosition === "top" || tailPosition === "bottom";
    if (tailOnAxis && tail > 0) body -= tail;
    return Math.max(0, body);
  };

  const halfPair = (body: number): [number, number] => {
    const first = Math.floor(body / 2);
    return [first, body - first];
  };

  const toPx = (value: number) => (unit === "mm" ? value * dpmm : value);

  const appliedLabel = () => {
    let newWidth = toPx(width);
    let newHeight = toPx(height);
    let newTailLength = toPx(tailLength);
    const newSizeA = Math.floor(toPx(splitSizeA));
    const newSizeB = Math.floor(toPx(splitSizeB));

    newWidth = newWidth < dpmm ? dpmm : newWidth;
    newHeight = newHeight < dpmm ? dpmm : newHeight;

    if (printDirection === "left") {
      newHeight -= newHeight % 8;
    } else {
      newWidth -= newWidth % 8;
    }

    const appliedWidth = Math.floor(newWidth);
    const appliedHeight = Math.floor(newHeight);
    const appliedTail = Math.floor(newTailLength);
    const bodyPx = bodyLength(split, appliedWidth, appliedHeight, appliedTail, tailPos);

    return { appliedWidth, appliedHeight, appliedTail, newSizeA, newSizeB, bodyPx };
  };

  let splitGap = $derived.by(() => {
    if (split === "none") return 0;
    return bodyLength(split, width, height, tailLength, tailPos) - splitSizeA - splitSizeB;
  });

  let splitInvalid = $derived.by(() => {
    if (split === "none") return false;
    if (splitSizeA < 1 || splitSizeB < 1 || splitGap < 0) return true;
    const { newSizeA, newSizeB, bodyPx } = appliedLabel();
    return newSizeA < 1 || newSizeB < 1 || newSizeA + newSizeB > bodyPx;
  });

  const onApply = () => {
    if (split !== "none" && splitInvalid) return;

    const { appliedWidth, appliedHeight, appliedTail, newSizeA, newSizeB } = appliedLabel();

    onChange({
      printDirection: printDirection,
      size: {
        width: appliedWidth,
        height: appliedHeight,
      },
      shape,
      split,
      splitParts: 2,
      tailPos,
      tailLength: appliedTail,
      mirror,
      ...(split === "none"
        ? {}
        : {
            shapeA,
            shapeB,
            splitSizeA: newSizeA,
            splitSizeB: newSizeB,
          }),
    });
  };

  const onLabelPresetSelected = (index: number) => {
    const preset = labelPresets[index];

    if (preset !== undefined) {
      dpmm = preset.dpmm;
      prevUnit = preset.unit;
      unit = preset.unit;
      printDirection = preset.printDirection;
      width = preset.width;
      height = preset.height;
      title = preset.title ?? "";
      shape = preset.shape ?? "rect";
      shapeA = preset.shapeA ?? preset.shape ?? "rect";
      shapeB = preset.shapeB ?? preset.shape ?? "rect";
      split = preset.split ?? "none";
      splitParts = preset.splitParts ?? 2;
      tailPos = preset.tailPos ?? "right";
      tailLength = preset.tailLength ?? 0;
      mirror = preset.mirror ?? "none";
      if (preset.splitSizeA !== undefined && preset.splitSizeB !== undefined) {
        splitSizeA = preset.splitSizeA;
        splitSizeB = preset.splitSizeB;
      } else {
        const [first, second] = halfPair(
          bodyLength(preset.split ?? "none", preset.width, preset.height, preset.tailLength ?? 0, preset.tailPos ?? "right"),
        );
        splitSizeA = first;
        splitSizeB = second;
      }
    }

    onApply();
  };

  const onLabelPresetDelete = (idx: number) => {
    const result = [...labelPresets];
    result.splice(idx, 1);
    labelPresets = result;
    LocalStoragePersistence.saveLabelPresets(labelPresets);
  };

  const onLabelPresetAdd = () => {
    const newPreset: LabelPreset = {
      dpmm,
      printDirection,
      unit,
      width,
      height,
      title,
      shape,
      shapeA,
      shapeB,
      split,
      splitParts,
      ...(splitSizeA > 0 ? { splitSizeA } : {}),
      ...(splitSizeB > 0 ? { splitSizeB } : {}),
      tailPos,
      tailLength,
      mirror,
    };
    const newPresets = [...labelPresets, newPreset];
    try {
      LocalStoragePersistence.saveLabelPresets(newPresets);
      labelPresets = newPresets;
    } catch (e) {
      Toasts.zodErrors(e, "Presets save error:");
    }
  };

  const onFlip = () => {
    let widthTmp = width;
    width = height;
    height = widthTmp;
    printDirection = printDirection === "top" ? "left" : "top";
    if (split === "vertical") split = "horizontal";
    else if (split === "horizontal") split = "vertical";
  };

  const onUnitChange = () => {
    if (prevUnit === "mm" && unit === "px") {
      width = Math.floor(width * dpmm);
      height = Math.floor(height * dpmm);
      tailLength = Math.floor(tailLength * dpmm);
      splitSizeA = Math.floor(splitSizeA * dpmm);
      splitSizeB = Math.floor(splitSizeB * dpmm);
    } else if (prevUnit === "px" && unit === "mm") {
      width = Math.floor(width / dpmm);
      height = Math.floor(height / dpmm);
      tailLength = Math.floor(tailLength / dpmm);
      splitSizeA = Math.floor(splitSizeA / dpmm);
      splitSizeB = Math.floor(splitSizeB / dpmm);
    }
    prevUnit = unit;
  };

  const fillWithCurrentParams = () => {
    prevUnit = "px";
    width = labelProps.size.width;
    height = labelProps.size.height;
    printDirection = labelProps.printDirection;
    shape = labelProps.shape ?? "rect";
    shapeA = labelProps.shapeA ?? labelProps.shape ?? "rect";
    shapeB = labelProps.shapeB ?? labelProps.shape ?? "rect";
    split = labelProps.split ?? "none";
    splitParts = labelProps.splitParts ?? 2;
    tailPos = labelProps.tailPos ?? "right";
    tailLength = labelProps.tailLength ?? 0;
    mirror = labelProps.mirror ?? "none";
    if (labelProps.splitSizeA !== undefined && labelProps.splitSizeB !== undefined) {
      splitSizeA = labelProps.splitSizeA;
      splitSizeB = labelProps.splitSizeB;
    } else {
      const [first, second] = halfPair(
        bodyLength(
          labelProps.split ?? "none",
          labelProps.size.width,
          labelProps.size.height,
          labelProps.tailLength ?? 0,
          labelProps.tailPos ?? "right",
        ),
      );
      splitSizeA = first;
      splitSizeB = second;
    }
    onUnitChange();
  };

  const onImportClicked = async () => {
    const contents = await FileUtils.pickAndReadSingleTextFile("json");
    const rawData = JSON.parse(contents);

    if (!confirm($tr("params.label.warning.import"))) {
      return;
    }

    try {
      const presets = z.array(LabelPresetSchema).parse(rawData);
      LocalStoragePersistence.saveLabelPresets(presets);
      labelPresets = presets;
    } catch (e) {
      Toasts.zodErrors(e, "Presets load error:");
    }
  };

  const onExportClicked = () => {
    try {
      FileUtils.saveLabelPresetsAsJson(labelPresets);
    } catch (e) {
      Toasts.zodErrors(e, "Presets save error:");
    }
  };

  onMount(() => {
    const defaultPreset: LabelPreset = DEFAULT_LABEL_PRESETS[0];
    width = defaultPreset.width;
    height = defaultPreset.height;
    prevUnit = defaultPreset.unit;
    unit = defaultPreset.unit;
    printDirection = defaultPreset.printDirection;
    shape = defaultPreset.shape ?? "rect";
    shapeA = defaultPreset.shapeA ?? "rect";
    shapeB = defaultPreset.shapeB ?? "rect";
    split = defaultPreset.split ?? "none";
    tailPos = defaultPreset.tailPos ?? "right";
    tailLength = defaultPreset.tailLength ?? 0;
    mirror = defaultPreset.mirror ?? "none";

    try {
      const savedPresets: LabelPreset[] | null = LocalStoragePersistence.loadLabelPresets();
      if (savedPresets !== null) {
        labelPresets = savedPresets;
      }
    } catch (e) {
      Toasts.zodErrors(e, "Presets load error:");
    }

    tick().then(() => fillWithCurrentParams());
  });

  $effect(() => {
    if (split === "none" || tailLength < 0) tailLength = 0;
  });

  $effect(() => {
    if (split === "none") return;
    if (splitSizeA > 0 || splitSizeB > 0) return;
    const [first, second] = halfPair(bodyLength(split, width, height, tailLength, tailPos));
    if (first <= 0 && second <= 0) return;
    splitSizeA = first;
    splitSizeB = second;
  });

  $effect(() => {
    if (mirror === "flip" && splitParts !== 2) mirror = "copy";
  });
</script>

{#snippet shapePicker(idPrefix: string, label: string, selected: LabelShape, choose: (next: LabelShape) => void)}
  <div class="input-group flex-nowrap input-group-sm label-shape-switch mb-2" role="group">
    <span class="input-group-text w-100">{label}</span>
    {#each labelShapes as v (v)}
      <input
        type="radio"
        class="btn-check"
        name={idPrefix}
        id="{idPrefix}-{v}"
        autocomplete="off"
        checked={selected === v}
        onchange={() => choose(v)} />
      <label class="btn btn-outline-secondary px-3 shape-{v}" for="{idPrefix}-{v}">
        <div class="svg-icon"></div>
      </label>
    {/each}
  </div>
{/snippet}

<div class="dropdown">
  <button class="btn btn-sm btn-secondary" data-bs-toggle="dropdown" data-bs-auto-close="outside">
    <MdIcon icon="settings" />
  </button>
  <div class="dropdown-menu">
    <h6 class="dropdown-header">{$tr("params.label.menu_title")}</h6>

    <div class="px-3">
      <div class="p-1">
        <button class="btn btn-sm btn-outline-secondary" onclick={onImportClicked}>
          <MdIcon icon="data_object" />
          {$tr("params.label.import")}
        </button>
        <button class="btn btn-sm btn-outline-secondary" onclick={onExportClicked}>
          <MdIcon icon="data_object" />
          {$tr("params.label.export")}
        </button>
      </div>
      <div class="mb-3 {error ? 'cursor-help text-warning' : 'text-secondary'}" title={error}>
        {$tr("params.label.current")}
        {labelProps.size.width}x{labelProps.size.height}
        {$tr("params.label.px")}
        {#if labelProps.printDirection === "top"}
          ({$tr("params.label.direction")} {$tr("params.label.direction.top")})
        {:else if labelProps.printDirection === "left"}
          ({$tr("params.label.direction")} {$tr("params.label.direction.left")})
        {/if}
        <button class="btn btn-sm" onclick={fillWithCurrentParams}><MdIcon icon="arrow_downward" /></button>
      </div>

      <LabelPresetsBrowser
        class="mb-1"
        presets={labelPresets}
        onItemSelected={onLabelPresetSelected}
        onItemDelete={onLabelPresetDelete} />

      <div class="input-group flex-nowrap input-group-sm mb-2">
        <span class="input-group-text">{$tr("params.label.size")}</span>
        <input class="form-control" type="number" min="1" step={unit === "px" ? 8 : 1} bind:value={width} />
        <button class="btn btn-sm btn-secondary" onclick={onFlip}><MdIcon icon="swap_horiz" /></button>
        <input class="form-control" type="number" min="1" step={unit === "px" ? 8 : 1} bind:value={height} />
        <select class="form-select" bind:value={unit} onchange={onUnitChange}>
          <option value="mm"> {$tr("params.label.mm")}</option>
          <option value="px"> {$tr("params.label.px")}</option>
        </select>
      </div>

      {#if unit !== "px"}
        <DpiSelector bind:value={dpmm} />
      {/if}

      <div class="input-group flex-nowrap input-group-sm print-dir-switch mb-2" role="group">
        <span class="input-group-text w-100">{$tr("params.label.direction")}</span>
        {#each printDirections as v (v)}
          <input
            type="radio"
            class="btn-check"
            name="print-dir"
            id="print-dir-{v}"
            autocomplete="off"
            bind:group={printDirection}
            value={v} />
          <label class="btn btn-outline-secondary px-3" for="print-dir-{v}">
            <div class="svg-icon"></div>
          </label>
        {/each}
      </div>

      <div class="input-group flex-nowrap input-group-sm label-split-switch mb-2" role="group">
        <span class="input-group-text w-100">{$tr("params.label.split")}</span>
        {#each labelSplits as v (v)}
          <input
            type="radio"
            class="btn-check"
            name="label-split"
            id="label-split-{v}"
            autocomplete="off"
            bind:group={split}
            value={v} />
          <label class="btn btn-outline-secondary px-3" for="label-split-{v}">
            <div class="svg-icon"></div>
          </label>
        {/each}
      </div>

      {#if split === "none"}
        {@render shapePicker("label-shape", $tr("params.label.shape"), shape, (next) => (shape = next))}
      {:else}
        {@render shapePicker(
          "label-shape-a",
          $tr(split === "vertical" ? "params.label.shape.left" : "params.label.shape.top"),
          shapeA,
          (next) => (shapeA = next),
        )}
        {@render shapePicker(
          "label-shape-b",
          $tr(split === "vertical" ? "params.label.shape.right" : "params.label.shape.bottom"),
          shapeB,
          (next) => (shapeB = next),
        )}

        <div class="input-group flex-nowrap input-group-sm mb-2">
          <span class="input-group-text">
            {$tr(split === "vertical" ? "params.label.split.size.left" : "params.label.split.size.top")}
          </span>
          <input class="form-control" type="number" min="1" step={unit === "px" ? 1 : 0.1} bind:value={splitSizeA} />
          <span class="input-group-text">
            {$tr(split === "vertical" ? "params.label.split.size.right" : "params.label.split.size.bottom")}
          </span>
          <input class="form-control" type="number" min="1" step={unit === "px" ? 1 : 0.1} bind:value={splitSizeB} />
        </div>

        <div class="input-group flex-nowrap input-group-sm mb-2">
          <span class="input-group-text">{$tr("params.label.split.gap")}</span>
          <input class="form-control" type="text" readonly value={Number(splitGap.toFixed(2))} />
          <span class="input-group-text">
            {#if unit === "mm"}{$tr("params.label.mm")}{/if}
            {#if unit === "px"}{$tr("params.label.px")}{/if}
          </span>
        </div>

        {#if splitInvalid}
          <div class="text-warning small mb-2">{$tr("params.label.warning.split_size")}</div>
        {/if}
      {/if}

      {#if split !== "none"}
        <div class="input-group flex-nowrap input-group-sm mirror-switch mb-2" role="group">
          <span class="input-group-text w-100">{$tr("params.label.mirror")}</span>
          {#each mirrorTypes as v (v)}
            <input
              type="radio"
              class="btn-check"
              name="mirror"
              id="mirror-{v}"
              autocomplete="off"
              bind:group={mirror}
              value={v} />
            <label class="btn btn-outline-secondary px-3" for="mirror-{v}">
              <div class="svg-icon"></div>
            </label>
          {/each}
        </div>

        <div class="input-group flex-nowrap input-group-sm tail-pos-switch mb-2" role="group">
          <span class="input-group-text w-100">{$tr("params.label.tail.position")}</span>
          {#each tailPositions as v (v)}
            <input
              type="radio"
              class="btn-check"
              name="tail-pos"
              id="tail-{v}"
              autocomplete="off"
              bind:group={tailPos}
              value={v} />
            <label class="btn btn-outline-secondary px-3" for="tail-{v}">
              <div class="svg-icon"></div>
            </label>
          {/each}
        </div>

        <div class="input-group flex-nowrap input-group-sm mb-2">
          <span class="input-group-text">{$tr("params.label.tail.length")}</span>
          <input class="form-control" type="number" min="1" bind:value={tailLength} />
          <span class="input-group-text">
            {#if unit === "mm"}{$tr("params.label.mm")}{/if}
            {#if unit === "px"}{$tr("params.label.px")}{/if}
          </span>
        </div>
      {/if}

      <div class="input-group flex-nowrap input-group-sm mb-2">
        <span class="input-group-text">{$tr("params.label.label_title")}</span>
        <input class="form-control" type="text" bind:value={title} />
      </div>

      <div class="text-end">
        <button class="btn btn-sm btn-secondary" onclick={onLabelPresetAdd}>
          {$tr("params.label.save_template")}
        </button>
        <button class="btn btn-sm btn-primary" onclick={onApply} disabled={splitInvalid}>
          {$tr("params.label.apply")}
        </button>
      </div>
    </div>
  </div>
</div>

<style>
  .dropdown-menu {
    width: 100vw;
    max-width: 450px;
  }

  .cursor-help {
    cursor: help;
  }

  .svg-icon {
    height: 1.5em;
    width: 1.5em;
    background-size: cover;
  }

  .tail-pos-switch .svg-icon {
    background-image: url("../assets/tail-pos.svg");
  }
  .tail-pos-switch label[for="tail-bottom"] .svg-icon {
    transform: rotate(90deg);
  }
  .tail-pos-switch label[for="tail-bottom"] .svg-icon {
    transform: rotate(90deg);
  }
  .tail-pos-switch label[for="tail-left"] .svg-icon {
    transform: rotate(180deg);
  }
  .tail-pos-switch label[for="tail-top"] .svg-icon {
    transform: rotate(270deg);
  }
  .print-dir-switch .svg-icon {
    background-image: url("../assets/print-dir.svg");
  }
  .print-dir-switch label[for="print-dir-top"] .svg-icon {
    transform: rotate(90deg);
  }

  .label-shape-switch label.shape-rect .svg-icon {
    background-image: url("../assets/shape-rect.svg");
  }
  .label-shape-switch label.shape-rounded_rect .svg-icon {
    background-image: url("../assets/shape-rrect.svg");
  }
  .label-shape-switch label.shape-circle .svg-icon {
    background-image: url("../assets/shape-circle.svg");
  }

  .label-split-switch label[for="label-split-none"] .svg-icon {
    background-image: url("../assets/shape-rrect.svg");
  }
  .label-split-switch label[for="label-split-vertical"] .svg-icon {
    background-image: url("../assets/split-vertical.svg");
    transform: rotate(90deg);
  }
  .label-split-switch label[for="label-split-horizontal"] .svg-icon {
    background-image: url("../assets/split-vertical.svg");
  }

  .mirror-switch label[for="mirror-none"] .svg-icon {
    background-image: url("../assets/mirror-none.svg");
  }
  .mirror-switch label[for="mirror-copy"] .svg-icon {
    background-image: url("../assets/mirror-copy.svg");
  }
  .mirror-switch label[for="mirror-flip"] .svg-icon {
    background-image: url("../assets/mirror-flip.svg");
  }
</style>
