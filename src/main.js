import Three from "./core/Three";
import "./style.css";
import { initControls } from "./ui/controls";

document.addEventListener("DOMContentLoaded", () => {
	const container = document.querySelector("#app");
	const three = new Three(container);
	three.run();
	initControls(three);
});
