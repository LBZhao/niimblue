<script lang="ts">
  import Dropdown from "bootstrap/js/dist/dropdown";
  import * as fabric from "fabric";
  import { onDestroy, onMount, tick } from "svelte";
  import { ArUcoMarker } from "$/fabric-object/aruco";
  import { Barcode } from "$/fabric-object/barcode";
  import { QRCode } from "$/fabric-object/qrcode";
  import { iconCodepoints, type MaterialIcon } from "$/styles/mdi_icons";
  import {
    appConfig,
    automation,
    bundledFontsReady,
    connectedPrinterName,
    connectionState,
    csvData,
    loadedFonts,
    printerMeta,
  } from "$/stores";
  import {
    type ExportedLabelTemplate,
    type FabricJson,
    type LabelProps,
    type MoveDirection,
    type OjectType,
  } from "$/types";
  import { FileUtils } from "$/utils/file_utils";
  import { tr } from "$/utils/i18n";
  import { LabelDesignerObjectHelper } from "$/utils/label_designer_object_helper";
  import { LocalStoragePersistence } from "$/utils/persistence";
  import { Toasts } from "$/utils/toasts";
  import { UndoRedo, type UndoState } from "$/utils/undo_redo";
  import BarcodeParamsPanel from "$/components/designer-controls/BarcodeParamsControls.svelte";
  import CsvControl from "$/components/designer-controls/CsvControl.svelte";
  import GenericObjectParamsControls from "$/components/designer-controls/GenericObjectParamsControls.svelte";
  import IconPicker from "$/components/designer-controls/IconPicker.svelte";
  import LabelPropsEditor from "$/components/designer-controls/LabelPropsEditor.svelte";
  import MdIcon from "$/components/basic/MdIcon.svelte";
  import ObjectPicker from "$/components/designer-controls/ObjectPicker.svelte";
  import PrintPreview from "$/components/PrintPreview.svelte";
  import ArUcoParamsPanel from "$/components/designer-controls/ArUcoParamsControls.svelte";
  import QrCodeParamsPanel from "$/components/designer-controls/QRCodeParamsControls.svelte";
  import TextParamsControls from "$/components/designer-controls/TextParamsControls.svelte";
  import VariableInsertControl from "$/components/designer-controls/VariableInsertControl.svelte";
  import { DEFAULT_LABEL_PROPS, GRID_SIZE, OBJECT_DEFAULTS, RECENT_THUMBNAIL_HEIGHT } from "$/defaults";
  import { LabelDesignerUtils } from "$/utils/label_designer_utils";
  import SavedLabelsMenu from "$/components/designer-controls/SavedLabelsMenu.svelte";
  import { CustomCanvas } from "$/fabric-object/custom_canvas";
  import VectorParamsControls from "$/components/designer-controls/VectorParamsControls.svelte";
  import { CanvasUtils } from "$/utils/canvas_utils";
  import { isM2Printer } from "$/utils/print_direction";
  import RecentPrints from "$/components/designer-controls/RecentPrints.svelte";
  import FeedChip from "$/components/basic/FeedChip.svelte";
  import { historyFileName, rememberPrintedLabel } from "$/utils/recent_prints";
  import { z } from "zod";

  let htmlCanvas: HTMLCanvasElement;
  let canvasColumn: HTMLDivElement;

  let fabricCanvas = $state<CustomCanvas>();
  let labelProps = $state<LabelProps>(DEFAULT_LABEL_PROPS);
  let previewOpened = $state<boolean>(false);
  let selectedObject = $state<fabric.FabricObject | undefined>(undefined);
  let selectedCount = $state<number>(0);
  let editRevision = $state<number>(0);
  let printNow = $state<boolean>(false);
  let csvEnabled = $state<boolean>(false);
  let windowWidth = $state<number>(0);
  let undoState = $state<UndoState>({ undoDisabled: false, redoDisabled: false });
  let zoomText = $state<string>("100%");

  const undo = new UndoRedo();

  const discardSelection = () => {
    fabricCanvas!.discardActiveObject();
    fabricCanvas!.requestRenderAll();
    selectedObject = undefined;
    selectedCount = 0;
    editRevision = 0;
  };

  const loadLabelData = async (data: ExportedLabelTemplate) => {
    undo.paused = true;
    const canvas = fabricCanvas!;
    canvas.suspendManagedLayout = true;
    onUpdateLabelProps(data.label);
    if (data.csv) {
      $csvData = data.csv;
      csvEnabled = true;
    }
    await FileUtils.loadCanvasState(canvas, data.canvas);
    canvas.suspendManagedLayout = false;
    canvas.layoutManagedText();
    undo.paused = false;
  };

  undo.onLabelUpdate = loadLabelData;
  undo.onStateUpdate = (state: UndoState) => {
    undoState = state;
  };

  const deleteSelected = () => {
    LabelDesignerUtils.deleteSelection(fabricCanvas!);
    discardSelection();
  };

  const cloneSelected = () => {
    LabelDesignerUtils.cloneSelection(fabricCanvas!).then(() => undo.push(fabricCanvas!, labelProps));
  };

  const moveSelected = (direction: MoveDirection, ctrl?: boolean) => {
    LabelDesignerUtils.moveSelection(fabricCanvas!, direction, ctrl);
    undo.push(fabricCanvas!, labelProps);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const key: string = e.key.toLowerCase();
    // windows and linux users are used to ctrl, mac users use cmd
    const cmdOrCtrl = e.metaKey || e.ctrlKey;

    // Esc
    if (key === "escape") {
      discardSelection();
      return;
    }

    if (LabelDesignerUtils.isAnyInputFocused(fabricCanvas!)) {
      return;
    }

    // Arrows
    if (key.startsWith("arrow")) {
      moveSelected(key.slice("arrow".length) as MoveDirection, cmdOrCtrl);
      return;
    }

    if (e.repeat) {
      return;
    }

    // Ctrl + D
    if (cmdOrCtrl && key === "d") {
      e.preventDefault();
      cloneSelected();
      return;
    }

    // Ctrl + Y, Ctrl + Shift + Z
    if ((cmdOrCtrl && key === "y") || (cmdOrCtrl && e.shiftKey && key === "z")) {
      e.preventDefault();
      if (!undoState.redoDisabled) {
        undo.redo();
      }
      return;
    }

    // Ctrl + Z
    if (cmdOrCtrl && key === "z") {
      e.preventDefault();
      if (!undoState.undoDisabled) {
        undo.undo();
      }
      return;
    }

    // Del
    if (key === "delete" || key === "backspace") {
      deleteSelected();
      return;
    }
  };

  /** Shrink the label to the screen width. Wide screens keep 100%. */
  const fitZoomToScreen = () => {
    if (!fabricCanvas || !canvasColumn) return;
    const style = getComputedStyle(canvasColumn);
    // Column padding, the 1px wrapper border on each side, and a feed chip beside the label.
    const sideChip = canvasColumn.querySelector<HTMLElement>(".feed-chip.feed-left");
    const chipWidth = sideChip ? sideChip.offsetWidth + 4 : 0;
    const available =
      canvasColumn.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - 2 - chipWidth;
    fabricCanvas.fitToWidth(available);
  };

  const onUpdateLabelProps = (newProps: LabelProps) => {
    labelProps = newProps;
    fabricCanvas!.setDimensions(labelProps.size);
    fabricCanvas!.setLabelProps(labelProps);
    fitZoomToScreen();
    try {
      LocalStoragePersistence.saveLastLabelProps(labelProps);
      undo.push(fabricCanvas!, labelProps);
    } catch (e) {
      Toasts.zodErrors(e, "Label parameters save error:");
    }
  };

  const exportCurrentLabel = (): ExportedLabelTemplate => {
    return FileUtils.makeExportedLabel(fabricCanvas!, labelProps, csvEnabled);
  };

  const onLoadRequested = (label: ExportedLabelTemplate) => {
    return loadLabelData(label).then(() => undo.push(fabricCanvas!, labelProps));
  };

  /** One tap, no confirm. Undo brings back the previous label. */
  const loadRecentPrint = (label: ExportedLabelTemplate) => {
    discardSelection();
    onLoadRequested(label).catch((e) => Toasts.error(e));
  };

  const onPrinted = () => {
    try {
      const printed = FileUtils.makeExportedLabel(fabricCanvas!, labelProps, csvEnabled, RECENT_THUMBNAIL_HEIGHT);
      const { isNew, dropped } = rememberPrintedLabel(printed);
      if (dropped > 0) Toasts.message($tr("editor.recent_prints.trimmed").replace("{n}", String(dropped)));
      // A label printed for the first time is also kept as a file in Documents/NiimBlue/History.
      // Quietly: only a failure is worth a message.
      if (isNew) {
        FileUtils.saveLabelToPhone(printed, {
          folder: "History",
          fileName: historyFileName(printed),
          keepExisting: true,
        }).catch((e) => Toasts.error(e));
      }
    } catch (e) {
      if (e instanceof z.ZodError) Toasts.zodErrors(e, "Recent prints save error:");
      else Toasts.error(e);
    }
  };

  const zplImageReady = async (img: Blob) => {
    await LabelDesignerObjectHelper.addImageBlob(fabricCanvas!, img);
    undo.push(fabricCanvas!, labelProps);
  };

  const pdfImageReady = async (el: HTMLCanvasElement) => {
    const img = new fabric.FabricImage(el, {
      ...OBJECT_DEFAULTS,
      left: 0,
      top: 0,
    });

    fabricCanvas!.add(img);
    fabricCanvas!.setActiveObject(img);
    undo.push(fabricCanvas!, labelProps);
  };

  const onObjectPicked = (objectType: OjectType) => {
    const obj = LabelDesignerObjectHelper.addObject(fabricCanvas!, objectType);
    if (obj !== undefined) {
      fabricCanvas!.setActiveObject(obj);
      undo.push(fabricCanvas!, labelProps);
    }
  };

  const onIconPicked = (i: MaterialIcon) => {
    // todo: icon is not vertically centered
    LabelDesignerObjectHelper.addStaticText(fabricCanvas!, String.fromCodePoint(iconCodepoints[i]), {
      fontFamily: "Material Icons",
      fontSize: 100,
    });
    undo.push(fabricCanvas!, labelProps);
  };

  const onSvgIconPicked = (i: string) => {
    LabelDesignerObjectHelper.addSvg(fabricCanvas!, i);
    undo.push(fabricCanvas!, labelProps);
  };

  const openPreview = () => {
    printNow = false;
    previewOpened = true;
  };

  const openPreviewAndPrint = () => {
    printNow = true;
    previewOpened = true;
  };

  const controlValueUpdated = () => {
    if (selectedObject) {
      fabricCanvas!.syncManagedFont(selectedObject);
      selectedObject.setCoords();
      selectedObject.dirty = true;
      undo.push(fabricCanvas!, labelProps);
    }
    fabricCanvas!.requestRenderAll();

    // trigger reactivity for controls
    editRevision++;
  };

  const getCanvasForPreview = (): FabricJson => {
    return fabricCanvas!.toJSON();
  };

  const onCsvPlaceholderPicked = (name: string) => {
    const obj = LabelDesignerObjectHelper.addText(fabricCanvas!, `{${name}}`, {
      textAlign: "left",
      originX: "left",
      originY: "top",
    });
    fabricCanvas!.setActiveObject(obj);
    undo.push(fabricCanvas!, labelProps);
  };

  const onPaste = async (event: ClipboardEvent) => {
    if (LabelDesignerUtils.isAnyInputFocused(fabricCanvas!)) {
      return;
    }

    const openedDropdowns = document.querySelectorAll(".dropdown-menu.show");
    if (openedDropdowns.length > 0) {
      return;
    }

    if (event.clipboardData != null) {
      event.preventDefault();
      const obj = await LabelDesignerObjectHelper.addObjectFromClipboard(fabricCanvas!, event.clipboardData);

      if (obj !== undefined) {
        fabricCanvas!.setActiveObject(obj);
        undo.push(fabricCanvas!, labelProps);
      }
    }
  };

  const clearCanvas = () => {
    if (!confirm($tr("editor.clear.confirm"))) {
      return;
    }
    undo.push(fabricCanvas!, labelProps);
    fabricCanvas!.clear();
  };

  const toggleGrid = () => {
    const newVal = !$appConfig.gridEnabled;
    appConfig.update((cfg) => ({ ...cfg, gridEnabled: newVal }));
    fabricCanvas?.setGridEnabled(newVal);
  };

  const loadLabelFromUrl = async () => {
    try {
      const urlTemplate = await FileUtils.readLabelFromUrl();

      if (urlTemplate !== null && confirm($tr("params.saved_labels.load.url.warn"))) {
        await onLoadRequested(urlTemplate);
        Toasts.message($tr("params.saved_labels.load.url.loaded"));
        return true;
      }
    } catch (e) {
      Toasts.error(e);
    }
    return false;
  };

  const loadDefaultLabel = async () => {
    const urlLoaded = await loadLabelFromUrl();

    if (urlLoaded) {
      return;
    }

    try {
      const defaultTemplate = LocalStoragePersistence.loadDefaultTemplate();

      if (defaultTemplate !== null) {
        await onLoadRequested(defaultTemplate);
        return;
      }
    } catch (e) {
      Toasts.error(e);
    }
  };

  const renderOnFontsChanged = () => {
    fabricCanvas?.forEachObject((o) => {
      if (o instanceof fabric.Textbox) {
        o.dirty = true;
      }
    });
    fabricCanvas?.layoutManagedText();
    fabricCanvas?.requestRenderAll();
  };

  onMount(async () => {
    try {
      const savedLabelProps = LocalStoragePersistence.loadLastLabelProps();
      if (savedLabelProps !== null) {
        labelProps = savedLabelProps;
      }
    } catch (e) {
      Toasts.zodErrors(e, "Label parameters load error:");
    }

    fabricCanvas = new CustomCanvas(htmlCanvas, {
      width: labelProps.size.width,
      height: labelProps.size.height,
    });
    fabricCanvas.defaultLabelText = $tr("editor.default_text");
    fabricCanvas.suspendManagedLayout = true;
    fabricCanvas.setLabelProps(labelProps);
    fabricCanvas.onZoomChange = (z) => {
      zoomText = Math.round(z * 100) + "%";
    };
    fabricCanvas.setGridEnabled(!!$appConfig.gridEnabled);

    try {
      await loadDefaultLabel();
    } finally {
      fabricCanvas.suspendManagedLayout = false;
      fabricCanvas.layoutManagedText();
      fitZoomToScreen();
    }

    window.addEventListener("hashchange", loadLabelFromUrl);

    undo.push(fabricCanvas, labelProps);

    // force close dropdowns on touch devices
    fabricCanvas.on("mouse:down", (): void => {
      const dropdowns = document.querySelectorAll("[data-bs-toggle='dropdown']");
      dropdowns.forEach((el) => new Dropdown(el).hide());
    });

    fabricCanvas.on("object:moving", (e): void => {
      if (e.target && e.target.left !== undefined && e.target.top !== undefined) {
        e.target.set({
          left: Math.round(e.target.left / GRID_SIZE) * GRID_SIZE,
          top: Math.round(e.target.top / GRID_SIZE) * GRID_SIZE,
        });
      }
    });

    fabricCanvas.on("object:modified", (): void => {
      undo.push(fabricCanvas!, labelProps);
    });

    fabricCanvas.on("text:changed", () => {
      editRevision++;
    });

    fabricCanvas.on("object:removed", (): void => {
      if (fabricCanvas?.layoutQuiet) return;
      undo.push(fabricCanvas!, labelProps);
    });

    fabricCanvas.on("selection:created", (e): void => {
      selectedCount = e.selected?.length ?? 0;
      selectedObject = e.selected?.length === 1 ? e.selected[0] : undefined;
      editRevision++;
    });

    fabricCanvas.on("selection:updated", (e): void => {
      selectedCount = e.selected?.length ?? 0;
      selectedObject = e.selected?.length === 1 ? e.selected[0] : undefined;
      editRevision++;
    });

    fabricCanvas.on("selection:cleared", (): void => {
      selectedObject = undefined;
      selectedCount = 0;
      editRevision++;
    });

    fabricCanvas.on("dragover", (e): void => {
      e.e.preventDefault();
    });

    fabricCanvas.on("drop:after", async (e): Promise<void> => {
      const dragEvt = e.e as DragEvent;
      dragEvt.preventDefault();

      let dropped = false;

      if (dragEvt.dataTransfer?.files) {
        for (const file of dragEvt.dataTransfer.files) {
          try {
            await LabelDesignerObjectHelper.addImageFile(fabricCanvas!, file);
            dropped = true;
          } catch (e) {
            Toasts.error(e);
          }
        }

        if (dropped) {
          undo.push(fabricCanvas!, labelProps);
        }
      }
    });

    fabricCanvas.on("object:scaling", (e): void => {
      if (!e.target) {
        return;
      }

      CanvasUtils.fixFabricObjectScale(e.target);
    });

    // userFonts.subscribe((e) => {console.log(e); renderOnFontsChanged();});

    if ($automation !== undefined) {
      if ($automation.startPrint !== undefined) {
        if ($automation.startPrint === "immediately") {
          openPreview();
        } else if ($automation.startPrint === "after_connect") {
          const unsubscribe = connectionState.subscribe((st) => {
            if (st === "connected") {
              tick().then(() => unsubscribe());
              openPreviewAndPrint();
            }
          });
        }
      }
    }
  });

  onDestroy(() => {
    fabricCanvas!.dispose();
    window.removeEventListener("hashchange", loadLabelFromUrl);
  });

  $effect(() => {
    fabricCanvas?.setLabelProps(labelProps);
  });

  $effect(() => {
    if (!fabricCanvas) return;
    if (!isM2Printer($printerMeta?.model, $connectedPrinterName)) return;
    if (labelProps.printDirection === "top") return;
    onUpdateLabelProps({ ...labelProps, printDirection: "top" });
  });

  // Rotating the phone or resizing the window refits the label.
  $effect(() => {
    if (windowWidth > 0) fitZoomToScreen();
  });

  $effect(() => {
    if (!previewOpened) {
      printNow = false;
    }
  });

  $effect(() => {
    if ($loadedFonts) {
      renderOnFontsChanged();
    }
  });

  $effect(() => {
    if ($bundledFontsReady) {
      renderOnFontsChanged();
    }
  });
</script>

<svelte:window bind:innerWidth={windowWidth} onkeydown={onKeyDown} onpaste={onPaste} />

<div class="image-editor">
  <div class="row mb-3">
    <div class="col d-flex justify-content-center" bind:this={canvasColumn}>
      <div class="feed-stage feed-{labelProps.printDirection}">
        <FeedChip direction={labelProps.printDirection} />
        <div class="canvas-wrapper">
          <canvas bind:this={htmlCanvas}></canvas>
        </div>
      </div>
    </div>
  </div>

  <div class="row mb-1">
    <div class="col d-flex justify-content-center">
      <div class="toolbar d-flex flex-wrap gap-1 justify-content-center align-items-center">
        <div class="tool-group" role="group" aria-label="Label">
          <LabelPropsEditor {labelProps} onChange={onUpdateLabelProps} />
          <SavedLabelsMenu
            canvas={fabricCanvas!}
            onRequestLabelTemplate={exportCurrentLabel}
            {onLoadRequested}
            {csvEnabled} />
          <button class="btn btn-sm btn-secondary" onclick={clearCanvas} title={$tr("editor.clear")}>
            <MdIcon icon="cancel_presentation" />
          </button>
        </div>

        <div class="tool-group" role="group" aria-label="History">
          <button
            class="btn btn-sm btn-secondary"
            disabled={undoState.undoDisabled}
            onclick={() => undo.undo()}
            title={$tr("editor.undo")}>
            <MdIcon icon="undo" />
          </button>
          <button
            class="btn btn-sm btn-secondary"
            disabled={undoState.redoDisabled}
            onclick={() => undo.redo()}
            title={$tr("editor.redo")}>
            <MdIcon icon="redo" />
          </button>
        </div>

        <div class="tool-group" role="group" aria-label="Insert">
          <ObjectPicker onSubmit={onObjectPicked} {labelProps} {zplImageReady} {pdfImageReady} />
          <IconPicker onSubmit={onIconPicked} onSubmitSvg={onSvgIconPicked} />
          <CsvControl bind:enabled={csvEnabled} onPlaceholderPicked={onCsvPlaceholderPicked} />
        </div>

        <div class="tool-group" role="group" aria-label="View">
          <button
            class="btn btn-sm {$appConfig.gridEnabled ? 'btn-primary' : 'btn-secondary'}"
            onclick={toggleGrid}
            title={$tr("editor.grid")}>
            <MdIcon icon="grid_on" />
          </button>
          <button class="btn btn-sm btn-secondary" onclick={fitZoomToScreen} title="Fit to screen">
            {zoomText}
          </button>
        </div>

        <!-- On phones this becomes a bar at the bottom of the screen, in thumb reach. -->
        <div class="print-actions d-flex gap-1 ms-1">
          <button class="btn btn-sm btn-secondary" onclick={openPreview}>
            <MdIcon icon="visibility" />
            {$tr("editor.preview")}
          </button>
          <button
            title="Print with default or saved parameters"
            class="btn btn-sm btn-primary"
            onclick={openPreviewAndPrint}
            disabled={$connectionState !== "connected"}><MdIcon icon="print" /> {$tr("editor.print")}</button>
        </div>
      </div>
    </div>
  </div>

  <div class="row mb-1">
    <div class="col d-flex justify-content-center">
      <div class="toolbar d-flex flex-wrap gap-1 justify-content-center align-items-center">
        {#if selectedCount > 0}
          <div class="tool-group" role="group" aria-label="Object">
            <button class="btn btn-sm btn-secondary" onclick={cloneSelected} title={$tr("editor.clone")}>
              <MdIcon icon="content_copy" />
            </button>
            <button class="btn btn-sm btn-secondary" onclick={deleteSelected} title={$tr("editor.delete")}>
              <MdIcon icon="delete" />
            </button>
          </div>
        {/if}

        {#if selectedObject && selectedCount === 1}
          <GenericObjectParamsControls {selectedObject} {editRevision} valueUpdated={controlValueUpdated} />
        {/if}

        {#if selectedObject}
          <VectorParamsControls {selectedObject} {editRevision} valueUpdated={controlValueUpdated} />
        {/if}

        {#if selectedObject instanceof fabric.IText}
          <TextParamsControls selectedText={selectedObject} {editRevision} valueUpdated={controlValueUpdated}>
            {#snippet content()}
              <!-- Always set here: this only renders while a text object is selected. -->
              <VariableInsertControl selectedObject={selectedObject!} valueUpdated={controlValueUpdated} />
            {/snippet}
          </TextParamsControls>
        {/if}

        {#if selectedObject instanceof QRCode}
          <div class="tool-group" role="group" aria-label="QR code">
            <QrCodeParamsPanel selectedQRCode={selectedObject} {editRevision} valueUpdated={controlValueUpdated} />
            <VariableInsertControl {selectedObject} valueUpdated={controlValueUpdated} />
          </div>
        {/if}

        {#if selectedObject instanceof ArUcoMarker}
          <div class="tool-group" role="group" aria-label="ArUco marker">
            <ArUcoParamsPanel selectedArUco={selectedObject} {editRevision} valueUpdated={controlValueUpdated} />
          </div>
        {/if}

        {#if selectedObject instanceof Barcode}
          <div class="tool-group" role="group" aria-label="Barcode">
            <BarcodeParamsPanel selectedBarcode={selectedObject} {editRevision} valueUpdated={controlValueUpdated} />
            {#if selectedObject.encoding === "CODE128B"}
              <VariableInsertControl {selectedObject} valueUpdated={controlValueUpdated} />
            {/if}
          </div>
        {/if}
      </div>
    </div>
  </div>

  <!-- Below the selection controls, so they stay next to the canvas. -->
  <div class="row mb-1">
    <div class="col d-flex justify-content-center">
      <RecentPrints onLoad={loadRecentPrint} />
    </div>
  </div>

  {#if previewOpened}
    <PrintPreview
      bind:show={previewOpened}
      canvasCallback={getCanvasForPreview}
      {labelProps}
      {printNow}
      {csvEnabled}
      csvData={$csvData.data}
      {onPrinted} />
  {/if}
</div>

<style>
  .canvas-wrapper {
    border: 1px solid rgba(0, 0, 0, 0.4);
    background-color: rgba(60, 55, 63, 0.5);
    max-width: 100%;
    max-height: 70vh;
    overflow: auto;
  }
  .canvas-wrapper :global(.canvas-container),
  .canvas-wrapper :global(canvas) {
    touch-action: none;
    max-width: none;
  }
  .canvas-wrapper canvas {
    image-rendering: pixelated;
    display: block;
  }

  @media (max-width: 767.98px) {
    .print-actions {
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      /* Below dropdowns (1000) and modals, above the page. */
      z-index: 990;
      margin: 0 !important;
      gap: 8px !important;
      padding: 8px calc(12px + var(--app-inset-right)) calc(8px + var(--app-inset-bottom))
        calc(12px + var(--app-inset-left));
      background: var(--bs-body-bg);
      border-top: 1px solid var(--bs-border-color);
    }

    .print-actions .btn {
      flex: 1;
      min-height: 48px;
      font-size: 1rem;
    }

    /* Keep the end of the page clear of the bar. */
    :global(.page-wrapper) {
      padding-bottom: 72px;
    }
  }
</style>
