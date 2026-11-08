<script lang="ts">
  import {
    LabelPresetSchema,
    type LabelPreset,
    type LabelProps,
    type LabelShape,
    type LabelSplit,
    type LabelUnit,
    type MirrorType,
    type PreviewPropsOffset,
    type TailPosition,
  } from "$/types";
  import LabelPresetsBrowser from "$/components/designer-controls/LabelPresetsBrowser.svelte";
  import { printerInfo, printerMeta } from "$/stores/app";
  import { tr } from "$/utils/i18n";
  import { DEFAULT_LABEL_PRESETS } from "$/defaults";
  import { onMount, tick } from "svelte";
  import { LocalStoragePersistence } from "$/utils/persistence";
  import type { PrintDirection } from "@mmote/niimbluelib";
  import MdIcon from "$/components/basic/MdIcon.svelte";
  import { Toasts } from "$/utils/toasts";
  import { FileUtils } from "$/utils/file_utils";
  import DpiSelector from "$/components/designer-controls/DpiSelector.svelte";
  import { z } from "zod";
  import AppModal from "$/components/basic/AppModal.svelte";
  import { appConfirm } from "$/stores/confirm";
  import { DATE_FORMATS, dateStamp } from "$/utils/label_text_layout";

  interface Props {
    labelProps: LabelProps;
    onChange: (newProps: LabelProps) => void;
    onClose?: () => void;
  }

  let { labelProps, onChange, onClose }: Props = $props();

  const tailPositions: TailPosition[] = ["right", "bottom", "left", "top"];
  const printDirections: PrintDirection[] = ["left", "top"];
  const labelShapes: LabelShape[] = ["rect", "rounded_rect", "circle"];
  const labelSplits: LabelSplit[] = ["none", "vertical", "horizontal"];
  const mirrorTypes: MirrorType[] = ["none", "flip", "copy"];

  let labelPresets = $state<LabelPreset[]>(DEFAULT_LABEL_PRESETS);
  let selectedPresetIndex = $state<number>(-1);

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
  let dateShow = $state<boolean>(true);
  let dateFormat = $state<string>(DATE_FORMATS[0]);
  let dateDaysAhead = $state<number>(0);
  /** Printer pixels: x to the right, y down, as the print preview moves it. */
  let offset = $state<PreviewPropsOffset>({ x: 0, y: 0 });
  let hasPresetOffset = $state<boolean>(false);
  let modalRef: AppModal;

  let warnings = $derived.by<string[]>(() => {
    let lines: string[] = [];

    const printWidth = labelProps.printDirection == "left" ? labelProps.size.height : labelProps.size.width;

    let headSize = -1;

    if ($printerInfo?.printheadWidth !== undefined) {
      headSize = $printerInfo.printheadWidth;
    } else if ($printerMeta?.printheadPixels !== undefined) {
      headSize = $printerMeta.printheadPixels;
    }

    if (headSize > 0) {
      if (printWidth > headSize) {
        lines.push($tr("params.label.warning.width") + ` ${printWidth} > ${headSize}`);
      }
    }

    if ($printerMeta?.printDirection !== undefined && $printerMeta?.printDirection !== labelProps.printDirection) {
      let text = $tr("params.label.warning.direction") + " ";
      if ($printerMeta.printDirection == "left") {
        text += $tr("params.label.direction.left");
      } else {
        text += $tr("params.label.direction.top");
      }
      lines.push(text);
    }

    if (printWidth % 8 !== 0) {
      lines.push($tr("params.label.warning.div8"));
    }

    return lines;
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
      dpmm,
      date: { show: dateShow, format: dateFormat, daysAhead: Math.round(Number(dateDaysAhead) || 0) },
      offset: hasPresetOffset ? { x: offset.x, y: offset.y } : undefined,
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
    selectedPresetIndex = index;

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
      hasPresetOffset = preset.offset !== undefined;
      offset = preset.offset !== undefined ? { ...preset.offset } : getFallbackOffset();
    }
  };

  const applyAndClose = () => {
    if (split !== "none" && splitInvalid) return;
    onApply();
    modalRef.hide();
  };

  const onLabelPresetDelete = (idx: number) => {
    const result = [...labelPresets];
    result.splice(idx, 1);
    labelPresets = result;

    if (selectedPresetIndex === idx) {
      selectedPresetIndex = -1;
    } else if (selectedPresetIndex > idx) {
      selectedPresetIndex--;
    }

    LocalStoragePersistence.saveLabelPresets(labelPresets);
  };

  const getFallbackOffset = (): PreviewPropsOffset => {
    try {
      const savedOffset = LocalStoragePersistence.loadSavedPreviewProps()?.offset;
      if (savedOffset !== undefined) {
        return { ...savedOffset };
      }
    } catch (e) {
      console.warn("Preview offset load error:", e);
    }

    return { x: 0, y: 0 };
  };

  const onOffsetChange = () => {
    hasPresetOffset = true;
  };

  const makeLabelPreset = (): LabelPreset => ({
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
    offset: { x: offset.x, y: offset.y },
  });

  const onLabelPresetExport = (idx: number) => {
    try {
      FileUtils.saveLabelPresetAsJson(labelPresets[idx]);
    } catch (e) {
      Toasts.zodErrors(e, "Preset save error:");
    }
  };

  const onLabelPresetAdd = () => {
    const newPresets = [...labelPresets, makeLabelPreset()];
    try {
      LocalStoragePersistence.saveLabelPresets(newPresets);
      labelPresets = newPresets;
    } catch (e) {
      Toasts.zodErrors(e, "Presets save error:");
    }
  };

  const onLabelPresetReplace = async () => {
    if (selectedPresetIndex === -1) {
      return;
    }

    const confirmResult = await appConfirm({
      title: $tr("editor.warning.save"),
      buttons: ["yes", "no"],
    });

    if (confirmResult !== "yes") {
      return;
    }

    const newPresets = [...labelPresets];
    newPresets[selectedPresetIndex] = makeLabelPreset();

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
    if (labelProps.dpmm !== undefined) dpmm = labelProps.dpmm;
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
    dateShow = labelProps.date?.show !== false;
    dateFormat = labelProps.date?.format ?? DATE_FORMATS[0];
    dateDaysAhead = labelProps.date?.daysAhead ?? 0;
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
    hasPresetOffset = labelProps.offset !== undefined;
    offset = labelProps.offset !== undefined ? { ...labelProps.offset } : getFallbackOffset();
    onUnitChange();
  };

  const onImportClicked = async () => {
    try {
      const contents = await FileUtils.pickAndReadSingleTextFile("json");
      const rawData = JSON.parse(contents);
      const imported = FileUtils.parseSingleOrList(rawData, LabelPresetSchema);
      const items = imported.kind === "single" ? [imported.item] : imported.items;

      if (items.length === 0) {
        return;
      }

      const presets = [...labelPresets, ...items];
      LocalStoragePersistence.saveLabelPresets(presets);
      labelPresets = presets;
      selectedPresetIndex = -1;
    } catch (e) {
      if (e instanceof z.ZodError) {
        Toasts.zodErrors(e, "Presets load error:");
      } else {
        Toasts.error(e);
      }
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
    hasPresetOffset = defaultPreset.offset !== undefined;
    offset = defaultPreset.offset !== undefined ? { ...defaultPreset.offset } : getFallbackOffset();

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

<AppModal title={$tr("params.label.menu_title")} {onClose} bind:this={modalRef} size="lg">
  <div class="mb-1">
    <button class="btn btn-sm btn-outline-secondary" onclick={onImportClicked}>
      <MdIcon icon="data_object" />
      {$tr("params.label.import")}
    </button>
    <button class="btn btn-sm btn-outline-secondary" onclick={onExportClicked}>
      <MdIcon icon="data_object" />
      {$tr("params.label.export_all")}
    </button>
  </div>

  <div class="mb-2 text-secondary">
    {$tr("params.label.current")}
    {labelProps.size.width}x{labelProps.size.height}
    {$tr("params.label.px")}
    {#if labelProps.printDirection === "top"}
      ({$tr("params.label.direction")} {$tr("params.label.direction.top")})
    {:else if labelProps.printDirection === "left"}
      ({$tr("params.label.direction")} {$tr("params.label.direction.left")})
    {/if}
    <button class="btn btn-sm btn-outline-secondary" onclick={fillWithCurrentParams}><MdIcon icon="arrow_downward" /></button>
  </div>

  {#each warnings as line (line)}
    <div class="mb-1 text-warning">{line}</div>
  {/each}

  <LabelPresetsBrowser
    class="mb-1"
    presets={labelPresets}
    selectedIndex={selectedPresetIndex}
    onItemSelected={onLabelPresetSelected}
    onItemDelete={onLabelPresetDelete}
    onItemExport={onLabelPresetExport} />

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

  <div class="input-group input-group-sm mb-2">
    <span class="input-group-text">{$tr("preview.offset")}</span>
    <span class="input-group-text"><MdIcon icon="unfold_more" class="r-90" /></span>
    <input class="form-control" type="number" step="1" bind:value={offset.x} onchange={onOffsetChange} />
    <span class="input-group-text"><MdIcon icon="unfold_more" /></span>
    <input class="form-control" type="number" step="1" bind:value={offset.y} onchange={onOffsetChange} />
    <span class="input-group-text">{$tr("params.label.px")}</span>
  </div>

  <div class="input-group flex-nowrap input-group-sm mb-2">
    <span class="input-group-text">{$tr("params.label.date")}</span>
    <div class="input-group-text">
      <input class="form-check-input mt-0" type="checkbox" role="switch" bind:checked={dateShow} />
    </div>
    <select class="form-select" bind:value={dateFormat} disabled={!dateShow}>
      {#each DATE_FORMATS as f (f)}
        <option value={f}>{dateStamp({ format: f })}</option>
      {/each}
    </select>
  </div>

  {#if dateShow}
    <div class="input-group flex-nowrap input-group-sm mb-2">
      <span class="input-group-text">{$tr("params.label.date.days_ahead")}</span>
      <input class="form-control" type="number" min="0" step="1" bind:value={dateDaysAhead} />
      <span class="input-group-text">
        {dateStamp({ format: dateFormat, daysAhead: Math.round(Number(dateDaysAhead) || 0) })}
      </span>
    </div>
  {/if}

  <div class="input-group flex-nowrap input-group-sm">
    <span class="input-group-text">{$tr("params.label.label_title")}</span>
    <input class="form-control" type="text" bind:value={title} />
  </div>

  {#snippet footer()}
    <button class="btn btn-sm btn-secondary" onclick={onLabelPresetAdd}>
      {$tr("params.label.save_template")}
    </button>
    {#if selectedPresetIndex !== -1}
      <button class="btn btn-sm btn-secondary" onclick={onLabelPresetReplace}>
        {$tr("params.saved_labels.save.browser.replace")}
      </button>
    {/if}
    <button class="btn btn-sm btn-primary" onclick={applyAndClose} disabled={splitInvalid}>
      {$tr("params.label.apply")}
    </button>
  {/snippet}
</AppModal>

<style>
  .svg-icon {
    height: 1.5em;
    width: 1.5em;
    background-size: cover;
  }

  .tail-pos-switch .svg-icon {
    background-image: url("../assets/tail-pos.svg");
  }
  .tail-pos-switch label[for="tail-right"] .svg-icon {
    transform: rotate(0deg);
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
