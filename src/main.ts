import { mount } from "svelte";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "./styles/theme.css";
// Applies the saved theme to <html> before the first paint (no flash of the wrong theme).
import "./lib/stores/prefs.svelte";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "./lib/api";

// The notes window and the Files window (text and code files) share this page; each
// loads only its own code. In the browser preview, ?window=files shows the Files window.
const label = isTauri ? getCurrentWindow().label : (new URLSearchParams(location.search).get("window") ?? "main");
const { default: Root } = label === "files" ? await import("./files/FilesApp.svelte") : await import("./App.svelte");

mount(Root, { target: document.getElementById("app")! });
