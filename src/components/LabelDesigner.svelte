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
    dimensionsUpdateRequest,
    loadedFonts,
    printerMeta,
  } from "$/stores/app";
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
  import CsvControl from "$/components/dialogs/CsvControl.svelte";
  import GenericObjectParamsControls from "$/components/designer-controls/GenericObjectParamsControls.svelte";
  import IconPicker from "$/components/dialogs/IconPicker.svelte";
  import LabelPropsEditor from "$/components/dialogs/LabelPropsEditor.svelte";
  import MdIcon from "$/components/basic/MdIcon.svelte";
  import ObjectPicker from "$/components/dialogs/ObjectPicker.svelte";
  import PrintPreview from "$/components/dialogs/PrintPreview.svelte";
  import ArUcoParamsPanel from "$/components/designer-controls/ArUcoParamsControls.svelte";
  import QrCodeParamsPanel from "$/components/designer-controls/QRCodeParamsControls.svelte";
  import TextParamsControls from "$/components/designer-controls/TextParamsControls.svelte";
  import VariableInsertControl from "$/components/designer-controls/VariableInsertControl.svelte";
  import { DEFAULT_LABEL_PROPS, GRID_SIZE, OBJECT_DEFAULTS, RECENT_THUMBNAIL_HEIGHT } from "$/defaults";
  import { LabelDesignerUtils } from "$/utils/label_designer_utils";
  import SavedLabelsMenu from "$/components/dialogs/SavedLabelsMenu.svelte";
  import { CustomCanvas } from "$/fabric-object/custom_canvas";
  import { TextboxExt } from "$/fabric-object/textbox-ext";
  import VectorParamsControls from "$/components/designer-controls/VectorParamsControls.svelte";
  import { CanvasUtils } from "$/utils/canvas_utils";
  import { isM2Printer } from "$/utils/print_direction";
  import RecentPrints from "$/components/designer-controls/RecentPrints.svelte";
  import FeedChip from "$/components/basic/FeedChip.svelte";
  import { historyFileName, rememberPrintedLabel } from "$/utils/recent_prints";
  import { z } from "zod";
  import { appConfirm } from "$/stores/confirm";

  type DialogName = "none" | "preview" | "label_props" | "saved_labels" | "csv_props" | "icon_picker" | "object_picker";

  let htmlCanvas: HTMLCanvasElement;
  let canvasColumn: HTMLDivElement;
  let currentDialog = $state<DialogName>("none");

  let fabricCanvas = $state<CustomCanvas>();
  let labelProps = $state<LabelProps>(DEFAULT_LABEL_PROPS);
  let selectedObject = $state<fabric.FabricObject | undefined>(undefined);
  let selectedCount = $state<number>(0);
  let editRevision = $state<number>(0);
  /** The tab picked in the selection panel; kept while it fits what is selected. */
  let propsTab = $state<PropsTabId>("text");
  let printNow = $state<boolean>(false);
  let csvEnabled = $state<boolean>(false);
  let windowWidth = $state<number>(0);
  let undoState = $state<UndoState>({ undoDisabled: false, redoDisabled: false });
  let zoomText = $state<string>("100%");
  let hasUnsavedChanges = $state<boolean>(false);

  const undo = new UndoRedo();

  type PropsTabId = "text" | "font" | "style" | "object" | "arrange";

  const isShape = (o?: fabric.FabricObject) =>
    o instanceof fabric.Rect || o instanceof fabric.Circle || o instanceof fabric.Line || o instanceof fabric.Polyline;

  /** Tabs for what is selected, most used first. Nothing for several objects at once. */
  let propsTabs = $derived.by<{ id: PropsTabId; label: string }[]>(() => {
    if (!selectedObject || selectedCount !== 1) return [];
    const arrange = { id: "arrange" as const, label: $tr("editor.tab.arrange") };
    if (selectedObject instanceof fabric.IText) {
      return [
        { id: "text", label: $tr("editor.tab.text") },
        { id: "font", label: $tr("editor.tab.font") },
        arrange,
      ];
    }
    if (selectedObject instanceof QRCode) return [{ id: "object", label: $tr("editor.objectpicker.qrcode") }, arrange];
    if (selectedObject instanceof Barcode) return [{ id: "object", label: $tr("editor.objectpicker.barcode") }, arrange];
    if (selectedObject instanceof ArUcoMarker) return [{ id: "object", label: $tr("editor.objectpicker.aruco") }, arrange];
    if (isShape(selectedObject)) return [{ id: "style", label: $tr("editor.tab.style") }, arrange];
    return [arrange];
  });

  // Selecting something else starts on its main tab; the picked tab only stays for the same object.
  let lastSelected: fabric.FabricObject | undefined;
  $effect(() => {
    if (selectedObject === lastSelected) return;
    lastSelected = selectedObject;
    propsTab = propsTabs[0]?.id ?? "text";
  });

  /** The picked tab when this selection has it, otherwise the first one. */
  let activeTab = $derived<PropsTabId | undefined>(
    propsTabs.some((t) => t.id === propsTab) ? propsTab : propsTabs[0]?.id,
  );

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
    labelRevision++;
  };

  /** The label's main text box, which fits itself to the label. */
  const primaryBox = (): TextboxExt | undefined =>
    fabricCanvas
      ?.getObjects()
      .find((o): o is TextboxExt => o instanceof TextboxExt && o.labelRole === "primary");

  /** Bumped when a whole label is loaded or replaced, so the text field reads it again. */
  let labelRevision = $state<number>(0);

  /** The main text for the field under the label; empty while it is still the placeholder. */
  let quickText = $derived.by<string | undefined>(() => {
    void editRevision;
    void labelRevision;
    const box = primaryBox();
    if (!box) return undefined;
    return box.isPlaceholder() ? "" : box.text;
  });

  /** Typing in the field changes the label like typing on the label does; empty brings back the placeholder. */
  const onQuickTextInput = (value: string) => {
    const box = primaryBox();
    if (!box || !fabricCanvas) return;
    if (box.isEditing) box.exitEditing();
    box.set({ text: value === "" ? fabricCanvas.defaultLabelText : value });
    fabricCanvas.fire("text:changed", { target: box as unknown as fabric.IText });
    fabricCanvas.requestRenderAll();
  };

  undo.onLabelUpdate = async (data) => {
    await loadLabelData(data);
    hasUnsavedChanges = true;
  };

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
    // refresh the position inputs
    editRevision++;
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
    hasUnsavedChanges = true;
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

  const updateDimensions = (width: number, height: number) => {
    let newProps = { ...labelProps, size: { width, height } };
    onUpdateLabelProps(newProps);
  };

  const exportCurrentLabel = (): ExportedLabelTemplate => {
    return FileUtils.makeExportedLabel(fabricCanvas!, labelProps, csvEnabled);
  };

  const onLoadRequested = (label: ExportedLabelTemplate) => {
    return loadLabelData(label).then(() => {
      undo.push(fabricCanvas!, labelProps);
      hasUnsavedChanges = false;
    });
  };

  const onSave = () => {
    hasUnsavedChanges = false;
  };

  /** One tap, no confirm. Undo brings back the previous label. */
  const loadRecentPrint = (label: ExportedLabelTemplate) => {
    discardSelection();
    onLoadRequested(label).catch((e) => Toasts.error(e));
  };

  /** Load a printed label with today's date and print it; just preview when no printer is connected. */
  const reprintRecent = async (label: ExportedLabelTemplate) => {
    discardSelection();
    try {
      await onLoadRequested(label);
    } catch (e) {
      Toasts.error(e);
      return;
    }
    if ($connectionState === "connected") openPreviewAndPrint();
    else openPreview();
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
    currentDialog = "preview";
  };

  const openPreviewAndPrint = () => {
    printNow = true;
    currentDialog = "preview";
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

  const clearCanvas = async () => {
    const result = await appConfirm({
      title: $tr("editor.clear.confirm"),
      buttons: ["yes", "no"],
    });

    if (result === "yes") {
      undo.push(fabricCanvas!, labelProps);
      fabricCanvas!.clear();
    }
  };

  /** One tap, no confirm. Undo brings back the previous label. */
  const newLabel = () => {
    const canvas = fabricCanvas!;
    undo.paused = true;
    discardSelection();
    csvEnabled = false;
    // The date shows today again. Its format is a preference, so it stays.
    onUpdateLabelProps({ ...labelProps, date: { ...labelProps.date, show: true, daysAhead: 0 } });
    canvas.resetToNewLabel();
    undo.paused = false;
    undo.push(canvas, labelProps);
    labelRevision++;
  };

  const toggleGrid = () => {
    const newVal = !$appConfig.gridEnabled;
    appConfig.update((cfg) => ({ ...cfg, gridEnabled: newVal }));
    fabricCanvas?.setGridEnabled(newVal);
  };

  const loadLabelFromUrl = async () => {
    try {
      const urlTemplate = await FileUtils.readLabelFromUrl();

      if (urlTemplate === null) {
        return false;
      }

      const confirmResult = await appConfirm({
        title: $tr("params.saved_labels.load.url.warn"),
        buttons: ["yes", "no"],
      });

      if (confirmResult === "yes") {
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
      labelRevision++;
    }

    window.addEventListener("hashchange", loadLabelFromUrl);
    window.addEventListener("beforeunload", warnBeforeUnload);

    undo.push(fabricCanvas, labelProps);
    hasUnsavedChanges = false;

    // force close dropdowns on touch devices
    fabricCanvas.on("mouse:down", (): void => {
      const dropdowns = document.querySelectorAll("[data-bs-toggle='dropdown']");
      dropdowns.forEach((el) => new Dropdown(el).hide());
    });

    fabricCanvas.on("object:moving", (e): void => {
      if (e.target && e.target.left !== undefined && e.target.top !== undefined) {
        // Snap to the grid only when the grid is shown; otherwise move in whole pixels.
        const step = $appConfig.gridEnabled ? GRID_SIZE : 1;
        e.target.set({
          left: Math.round(e.target.left / step) * step,
          top: Math.round(e.target.top / step) * step,
        });
      }
    });

    fabricCanvas.on("object:modified", (): void => {
      hasUnsavedChanges = true;
      undo.push(fabricCanvas!, labelProps);
    });

    fabricCanvas.on("object:added", (): void => {
      hasUnsavedChanges = true;
    });

    fabricCanvas.on("text:changed", () => {
      hasUnsavedChanges = true;
      editRevision++;
    });

    fabricCanvas.on("object:removed", (): void => {
      if (fabricCanvas?.layoutQuiet) return;
      hasUnsavedChanges = true;
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

  const warnBeforeUnload = (event: BeforeUnloadEvent) => {
    if (!hasUnsavedChanges) return;
    event.preventDefault();
    event.returnValue = "";
  };

  onMount(() =>
    dimensionsUpdateRequest.subscribe((req) => {
      if (req) {
        updateDimensions(req.width, req.height);
      }
    }),
  );

  onDestroy(() => {
    fabricCanvas!.dispose();
    window.removeEventListener("hashchange", loadLabelFromUrl);
    window.removeEventListener("beforeunload", warnBeforeUnload);
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
    if (currentDialog !== "preview") {
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

  {#if quickText !== undefined}
    <!-- Type the label here instead of on the small label itself. -->
    <div class="row mb-3">
      <div class="col d-flex justify-content-center">
        <textarea
          class="form-control quick-text"
          rows={Math.min(4, Math.max(2, quickText.split("\n").length))}
          placeholder={$tr("editor.quick_text.placeholder")}
          aria-label={$tr("editor.quick_text")}
          value={quickText}
          oninput={(e) => onQuickTextInput(e.currentTarget.value)}
          onchange={() => undo.push(fabricCanvas!, labelProps)}></textarea>
      </div>
    </div>
  {/if}

  <div class="row mb-1">
    <div class="col d-flex justify-content-center">
      <div class="toolbar toolbar-main d-flex flex-wrap gap-1 justify-content-center align-items-center">
        <div class="tool-group" role="group" aria-label="Label">
          <button class="btn btn-sm btn-secondary" onclick={newLabel} title={$tr("editor.new_label")}>
            <MdIcon icon="note_add" />
          </button>
          <button
            class="btn btn-sm btn-secondary"
            onclick={() => (currentDialog = "saved_labels")}
            title={$tr("params.saved_labels.menu_title")}>
            <MdIcon icon="sd_storage" />
          </button>
          <button class="btn btn-sm btn-secondary" onclick={clearCanvas} title={$tr("editor.clear")}>
            <MdIcon icon="cancel_presentation" />
          </button>
          <button
            class="btn btn-sm btn-secondary"
            onclick={() => (currentDialog = "label_props")}
            title={$tr("params.label.menu_title")}>
            <MdIcon icon="settings" />
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

        <div class="tool-group insert-tools" role="group" aria-label="Insert">
          <button
            class="btn btn-sm btn-secondary"
            title={$tr("editor.objectpicker.title")}
            onclick={() => (currentDialog = "object_picker")}>
            <MdIcon icon="format_shapes" />
            <MdIcon icon="add" />
          </button>
          <button
            class="btn btn-sm btn-secondary"
            title={$tr("editor.iconpicker.title")}
            onclick={() => (currentDialog = "icon_picker")}>
            <MdIcon icon="emoji_emotions" />
            <MdIcon icon="add" />
          </button>
          <button
            class="btn btn-sm btn-{csvEnabled ? 'primary' : 'secondary'}"
            title={$tr("params.csv.title")}
            onclick={() => (currentDialog = "csv_props")}>
            <MdIcon icon="dataset" />
          </button>
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

  {#if selectedCount > 0}
    <!-- What is selected, in tabs: one short row of controls at a time instead of all of them at once. -->
    <div class="row mb-2">
      <div class="col d-flex justify-content-center">
        <div class="props-panel">
          <div class="props-head">
            {#if propsTabs.length > 1}
              <div class="props-tabs" role="tablist">
                {#each propsTabs as t (t.id)}
                  <button
                    role="tab"
                    class="props-tab"
                    class:active={activeTab === t.id}
                    aria-selected={activeTab === t.id}
                    onclick={() => (propsTab = t.id)}>
                    {t.label}
                  </button>
                {/each}
              </div>
            {:else}
              <span class="props-title text-secondary">
                {propsTabs[0]?.label ?? `${selectedCount} ×`}
              </span>
            {/if}
            <div class="ms-auto d-flex gap-1">
              <button class="btn btn-sm btn-outline-secondary" onclick={cloneSelected} title={$tr("editor.clone")}>
                <MdIcon icon="content_copy" />
              </button>
              <button class="btn btn-sm btn-outline-secondary" onclick={deleteSelected} title={$tr("editor.delete")}>
                <MdIcon icon="delete" />
              </button>
            </div>
          </div>

          <div class="toolbar d-flex flex-wrap gap-1 justify-content-center align-items-center">
            {#if activeTab === "arrange" && selectedObject && selectedCount === 1}
              <GenericObjectParamsControls {selectedObject} {editRevision} valueUpdated={controlValueUpdated} />
            {/if}

            {#if activeTab === "style" && selectedObject}
              <VectorParamsControls {selectedObject} {editRevision} valueUpdated={controlValueUpdated} />
            {/if}

            {#if (activeTab === "text" || activeTab === "font") && selectedObject instanceof fabric.IText}
              <TextParamsControls
                selectedText={selectedObject}
                section={activeTab}
                {editRevision}
                valueUpdated={controlValueUpdated}>
                {#snippet content()}
                  <!-- Always set here: this only renders while a text object is selected. -->
                  <VariableInsertControl selectedObject={selectedObject!} valueUpdated={controlValueUpdated} />
                {/snippet}
              </TextParamsControls>
            {/if}

            {#if activeTab === "object" && selectedObject instanceof QRCode}
              <div class="tool-group" role="group" aria-label="QR code">
                <QrCodeParamsPanel selectedQRCode={selectedObject} {editRevision} valueUpdated={controlValueUpdated} />
                <VariableInsertControl {selectedObject} valueUpdated={controlValueUpdated} />
              </div>
            {/if}

            {#if activeTab === "object" && selectedObject instanceof ArUcoMarker}
              <div class="tool-group" role="group" aria-label="ArUco marker">
                <ArUcoParamsPanel selectedArUco={selectedObject} {editRevision} valueUpdated={controlValueUpdated} />
              </div>
            {/if}

            {#if activeTab === "object" && selectedObject instanceof Barcode}
              <div class="tool-group" role="group" aria-label="Barcode">
                <BarcodeParamsPanel
                  selectedBarcode={selectedObject}
                  {editRevision}
                  valueUpdated={controlValueUpdated} />
                <VariableInsertControl {selectedObject} valueUpdated={controlValueUpdated} />
              </div>
            {/if}
          </div>
        </div>
      </div>
    </div>
  {/if}

  <!-- Below the selection controls, so they stay next to the canvas. -->
  <div class="row mb-1">
    <div class="col d-flex justify-content-center">
      <RecentPrints onLoad={loadRecentPrint} onPrint={reprintRecent} />
    </div>
  </div>

  {#if currentDialog === "preview"}
    <PrintPreview
      onClose={() => (currentDialog = "none")}
      canvasCallback={getCanvasForPreview}
      {labelProps}
      {printNow}
      {csvEnabled}
      csvData={$csvData.data}
      {onPrinted} />
  {:else if currentDialog === "label_props"}
    <LabelPropsEditor onClose={() => (currentDialog = "none")} onChange={onUpdateLabelProps} {labelProps} />
  {:else if currentDialog === "saved_labels"}
    <SavedLabelsMenu
      onClose={() => (currentDialog = "none")}
      {onSave}
      canvas={fabricCanvas!}
      onRequestLabelTemplate={exportCurrentLabel}
      {onLoadRequested}
      {csvEnabled}
      {hasUnsavedChanges} />
  {:else if currentDialog === "csv_props"}
    <CsvControl
      onClose={() => (currentDialog = "none")}
      bind:enabled={csvEnabled}
      onPlaceholderPicked={onCsvPlaceholderPicked} />
  {:else if currentDialog === "icon_picker"}
    <IconPicker onSubmit={onIconPicked} onSubmitSvg={onSvgIconPicked} onClose={() => (currentDialog = "none")} />
  {:else if currentDialog === "object_picker"}
    <ObjectPicker
      onSubmit={onObjectPicked}
      onClose={() => (currentDialog = "none")}
      {labelProps}
      {zplImageReady}
      {pdfImageReady} />
  {/if}
</div>

<style>
  /* The label sits on its own stage, a step lighter than the page. */
  .canvas-wrapper {
    border: 1px solid var(--app-border);
    border-radius: var(--bs-border-radius-lg);
    background-color: var(--app-surface-1);
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

  .quick-text {
    max-width: 620px;
    border-radius: var(--bs-border-radius-lg);
    background: var(--app-surface-1);
    font-size: 1.05rem;
    resize: none;
  }

  .props-panel {
    width: 100%;
    max-width: 620px;
    padding: 6px;
    border: 1px solid var(--app-border);
    border-radius: var(--bs-border-radius-xl);
    background: var(--app-surface-1);
  }

  .props-head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
  }

  .props-title {
    padding-left: 8px;
  }

  /* A segmented switch: the active tab is a raised pill. */
  .props-tabs {
    display: inline-flex;
    gap: 2px;
    padding: 3px;
    border-radius: 999px;
    background: var(--bs-body-bg);
    border: 1px solid var(--app-border);
  }

  .props-tab {
    border: 0;
    border-radius: 999px;
    padding: 0.35rem 0.9rem;
    min-height: 36px;
    background: transparent;
    color: var(--bs-secondary-color);
    font-weight: 600;
    font-size: 0.9rem;
  }

  .props-tab.active {
    background: var(--app-surface-3);
    color: var(--bs-emphasis-color);
  }

  /* Inside the panel the groups need no panel of their own. */
  .props-panel :global(.tool-group) {
    background: transparent;
    border-color: transparent;
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
      background: rgba(14, 17, 22, 0.88);
      backdrop-filter: blur(12px);
      border-top: 1px solid var(--app-border);
    }

    .print-actions .btn {
      flex: 1;
      min-height: 48px;
      font-size: 1rem;
      border-radius: 999px;
    }

    /* Keep the end of the page clear of the bar. */
    :global(.page-wrapper) {
      padding-bottom: 72px;
    }
  }
</style>
