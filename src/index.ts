import "$/styles/style.scss";
import "@popperjs/core";
import "toastify-js/src/toastify.css";
import "bootstrap/js/dist/dropdown";
import "bootstrap/js/dist/collapse";
import App from "$/App.svelte";
import { mount } from "svelte";
import { configureFabric } from "$/defaults";
import { FileUtils } from "$/utils/file_utils";

configureFabric();
FileUtils.loadBundledFonts().then(() => FileUtils.refreshStoredThumbnails());

const app = mount(App, {
  target: document.getElementById("app")!,
});

export default app;
