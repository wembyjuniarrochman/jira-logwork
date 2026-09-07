import { mount } from "svelte";
import QuickLogApp from "./lib/pages/QuickLogApp.svelte";
import "./app.css";

const app = mount(QuickLogApp, { target: document.getElementById("app")! });
export default app;
