<script lang="ts">
  import { Utils } from "@mmote/niimbluelib";
  import BrowserWarning from "$/components/basic/BrowserWarning.svelte";
  import LabelDesigner from "$/components/LabelDesigner.svelte";
  import PrinterConnector from "$/components/PrinterConnector.svelte";
  import { locale, locales, tr } from "$/utils/i18n";
  import DebugStuff from "$/components/dialogs/DebugStuff.svelte";
  import MdIcon from "$/components/basic/MdIcon.svelte";
  import AppPrompt from "$/components/dialogs/AppPrompt.svelte";
  import AppConfirm from "./dialogs/AppConfirm.svelte";

  // eslint-disable-next-line no-undef
  const appCommit = __APP_COMMIT__;
  // eslint-disable-next-line no-undef
  const appVersion = __APP_VERSION__;
  // eslint-disable-next-line no-undef
  const buildDate = __BUILD_DATE__;

  let isStandalone = Utils.getAvailableTransports().capacitorBle || "__TAURI__" in window;

  let debugStuffShow = $state<boolean>(false);
</script>

<div class="page-wrapper d-flex flex-column min-vh-100">
  <!-- Stays at the top while the page scrolls: the app's name, the printer, and the app menu. -->
  <header class="app-bar">
    <div class="container d-flex align-items-center gap-2">
      <h1 class="title mb-0 me-auto">
        <span class="niim">Niim</span><span class="blue">Blue{isStandalone ? "s" : ""}</span>
      </h1>

      <PrinterConnector />

      <div class="dropdown">
        <button
          class="btn btn-sm btn-outline-secondary menu-button"
          data-bs-toggle="dropdown"
          data-bs-auto-close="outside"
          title={$tr("main.menu")}
          aria-label={$tr("main.menu")}>
          <MdIcon icon="more_vert" />
        </button>
        <div class="dropdown-menu dropdown-menu-end p-3 app-menu">
          <label class="form-label small text-secondary mb-1" for="app-language">{$tr("main.language")}</label>
          <select id="app-language" class="form-select form-select-sm" bind:value={$locale}>
            {#each Object.entries(locales) as [key, name] (key)}
              <option value={key}>{name}</option>
            {/each}
          </select>

          <hr class="dropdown-divider my-3" />

          <a class="dropdown-item rounded" href="https://github.com/LBZhao/niimblue" target="_blank" rel="noopener">
            <MdIcon icon="code" />
            {$tr("main.code")}
          </a>
          <button class="dropdown-item rounded" onclick={() => (debugStuffShow = true)}>
            <MdIcon icon="bug_report" />
            {$tr("debug.title")}
          </button>

          <div class="small text-secondary mt-2 px-3">
            {#if appVersion}
              {appVersion} ·
            {:else if appCommit}
              {appCommit.slice(0, 6)} ·
            {/if}
            {$tr("main.built")}
            {buildDate}
          </div>
        </div>
      </div>
    </div>
  </header>

  <div class="container my-3 flex-grow-1">
    <div class="row">
      <div class="col">
        <BrowserWarning />
      </div>
    </div>

    <div class="row">
      <div class="col">
        <LabelDesigner />
      </div>
    </div>
  </div>

</div>

{#if debugStuffShow}
  <DebugStuff bind:show={debugStuffShow} />
{/if}

<AppPrompt />

<AppConfirm />

<style>
  .app-bar {
    position: sticky;
    top: 0;
    z-index: 980;
    /* Reach under the status bar, which the body is otherwise padded clear of. */
    margin-top: calc(-1 * var(--app-inset-top));
    padding: calc(0.5rem + var(--app-inset-top)) 0 0.5rem;
    background: rgba(14, 17, 22, 0.88);
    backdrop-filter: blur(12px);
    border-bottom: 1px solid var(--app-border);
  }

  .menu-button {
    border-radius: 999px;
  }

  .app-menu {
    width: 100vw;
    max-width: 280px;
  }

  .app-menu .dropdown-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .title {
    font-size: 1.4rem;
    font-weight: 750;
    letter-spacing: -0.02em;
  }

  .niim {
    color: #ff5a52;
  }

  .blue {
    color: #4c8dff;
  }
</style>
