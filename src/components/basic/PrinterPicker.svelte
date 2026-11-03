<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { BleClient, type ScanResult } from "@capacitor-community/bluetooth-le";
  import AppModal from "$/components/basic/AppModal.svelte";
  import MdIcon from "$/components/basic/MdIcon.svelte";
  import { tr } from "$/utils/i18n";
  import { Toasts } from "$/utils/toasts";
  import { isLikelyPrinterName } from "$/utils/printer_names";

  interface Props {
    show: boolean;
    /** Called with the chosen device. The picker closes itself. */
    onPick: (deviceId: string, name: string) => void;
  }

  type Found = { deviceId: string; name?: string; rssi: number };

  /** Wait this long after the scan starts before connecting to a lone printer. */
  const AUTO_PICK_DELAY_MS = 2500;
  /** If no printer was found by then, wait this long after the first one appears. */
  const AUTO_PICK_SETTLE_MS = 1500;

  let { show = $bindable(), onPick }: Props = $props();

  let found = $state<Record<string, Found>>({});
  let showAll = $state<boolean>(false);
  let scanning = $state<boolean>(false);
  let modalRef: AppModal;
  let picked = false;
  let waitingForFirstPrinter = false;
  let autoTimer: ReturnType<typeof setTimeout> | undefined;

  /** Nearest first. Printers only, unless "Show all devices" is on. */
  let visible = $derived.by<Found[]>(() =>
    Object.values(found)
      .filter((d) => (showAll ? d.name : isLikelyPrinterName(d.name)))
      .sort((a, b) => b.rssi - a.rssi),
  );

  let hiddenCount = $derived(Object.values(found).length - visible.length);

  const onResult = (r: ScanResult) => {
    const name = r.device.name ?? r.localName;
    found[r.device.deviceId] = { deviceId: r.device.deviceId, name, rssi: r.rssi ?? -127 };
    if (waitingForFirstPrinter && isLikelyPrinterName(name)) {
      waitingForFirstPrinter = false;
      autoTimer = setTimeout(autoPick, AUTO_PICK_SETTLE_MS);
    }
  };

  /** Exactly one printer nearby: connect to it without asking. Two or more: let the user choose. */
  const autoPick = () => {
    if (picked || showAll) return;
    const printers = Object.values(found).filter((d) => isLikelyPrinterName(d.name));
    if (printers.length === 1) pick(printers[0]);
    else if (printers.length === 0) waitingForFirstPrinter = true;
  };

  const stopScan = async () => {
    if (!scanning) return;
    scanning = false;
    try {
      await BleClient.stopLEScan();
    } catch (e) {
      console.warn(e);
    }
  };

  const pick = (d: Found) => {
    if (picked) return;
    picked = true;
    clearTimeout(autoTimer);
    stopScan();
    modalRef.hide();
    onPick(d.deviceId, d.name ?? d.deviceId);
  };

  /** Rough signal strength as 1 to 4 bars. */
  const bars = (rssi: number): number => (rssi >= -60 ? 4 : rssi >= -70 ? 3 : rssi >= -80 ? 2 : 1);

  onMount(async () => {
    try {
      await BleClient.initialize({ androidNeverForLocation: true });
      if (!(await BleClient.isEnabled())) throw new Error("Bluetooth is not enabled");
      await BleClient.requestLEScan({ allowDuplicates: false }, onResult);
      scanning = true;
      autoTimer = setTimeout(autoPick, AUTO_PICK_DELAY_MS);
    } catch (e) {
      Toasts.error(e);
      modalRef.hide();
    }
  });

  onDestroy(() => {
    clearTimeout(autoTimer);
    stopScan();
  });
</script>

<AppModal bind:this={modalRef} title={$tr("connector.pick.title")} bind:show onClose={stopScan}>
  <div class="d-flex flex-column gap-2">
    {#each visible as d (d.deviceId)}
      <button class="btn btn-outline-secondary d-flex align-items-center gap-2 text-start" onclick={() => pick(d)}>
        <MdIcon icon="print" />
        <span class="flex-grow-1 text-truncate">{d.name ?? d.deviceId}</span>
        <span class="signal" title="{d.rssi} dBm">
          {#each [1, 2, 3, 4] as b (b)}
            <span class="bar" class:on={b <= bars(d.rssi)} style="height: {b * 25}%"></span>
          {/each}
        </span>
      </button>
    {:else}
      <div class="text-secondary py-2">
        {#if scanning}
          <span class="spinner-border spinner-border-sm me-2"></span>
        {/if}
        {$tr("connector.pick.none")}
      </div>
    {/each}

    <div class="d-flex align-items-center justify-content-between flex-wrap gap-2 mt-1">
      <div class="form-check form-switch m-0">
        <input class="form-check-input" type="checkbox" id="pick-show-all" bind:checked={showAll} />
        <label class="form-check-label" for="pick-show-all">{$tr("connector.pick.show_all")}</label>
      </div>
      {#if !showAll && hiddenCount > 0}
        <small class="text-secondary">{$tr("connector.pick.hidden").replace("{n}", String(hiddenCount))}</small>
      {/if}
    </div>
  </div>
</AppModal>

<style>
  .signal {
    display: inline-flex;
    align-items: flex-end;
    gap: 2px;
    height: 14px;
  }

  .bar {
    width: 4px;
    border-radius: 1px;
    background: var(--bs-secondary-bg);
  }

  .bar.on {
    background: var(--bs-success);
  }
</style>
