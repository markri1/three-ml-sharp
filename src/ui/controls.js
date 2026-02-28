export function initControls(three) {
	if (!three) return;

	const scene = typeof three.getScene === "function" ? three.getScene() : three.scene;
	if (!scene) return;

	const cameraOptions =
		typeof scene.getCameraRigOptions === "function"
			? scene.getCameraRigOptions()
			: {};
	const flowOptions =
		typeof scene.getFlowFieldOptions === "function"
			? scene.getFlowFieldOptions()
			: {};

	setupPanelCollapse();
	setupCameraControls(scene, cameraOptions);
	setupFlowFieldControls(scene, flowOptions);
	setupUploadControls(scene);
}

function setupPanelCollapse() {
	const toggle = document.getElementById("control-panel-toggle");
	const content = document.getElementById("control-panel-content");
	const chevron = document.getElementById("control-panel-chevron");

	if (!toggle || !content || !chevron) return;

	let collapsed = false;

	function updateCollapsed(value) {
		collapsed = !!value;
		toggle.setAttribute("aria-expanded", String(!collapsed));
		if (collapsed) {
			content.classList.add("collapsed");
			chevron.classList.add("collapsed");
		} else {
			content.classList.remove("collapsed");
			chevron.classList.remove("collapsed");
		}
	}

	toggle.addEventListener("click", () => {
		updateCollapsed(!collapsed);
	});
}

function setupCameraControls(scene, cameraOptions) {
	const dampingInput = document.getElementById("camera-damping");
	const dampingValue = document.getElementById("camera-damping-value");
	const movementToggle = document.getElementById("camera-movement-toggle");
	const dampingContainer = document.getElementById("camera-damping-controls");

	if (!dampingInput) return;

	const initialDamping =
		typeof cameraOptions.damping === "number"
			? cameraOptions.damping
			: Number(dampingInput.value) || 2;
	const initialEnabled = cameraOptions.enabled !== false;

	dampingInput.value = String(initialDamping);
	if (dampingValue) {
		dampingValue.textContent = initialDamping.toFixed(1);
	}

	function setDampingVisible(visible) {
		if (dampingContainer) {
			dampingContainer.classList.toggle("hidden", !visible);
		}
	}

	if (movementToggle) {
		const knob = movementToggle.querySelector("span");
		movementToggle.setAttribute("aria-checked", String(initialEnabled));
		movementToggle.setAttribute("data-checked", initialEnabled ? "true" : "false");
		if (knob) knob.setAttribute("data-checked", initialEnabled ? "true" : "false");
		setDampingVisible(initialEnabled);

		movementToggle.addEventListener("click", () => {
			const next = movementToggle.getAttribute("data-checked") !== "true";
			movementToggle.setAttribute("aria-checked", String(next));
			movementToggle.setAttribute("data-checked", next ? "true" : "false");
			if (knob) knob.setAttribute("data-checked", next ? "true" : "false");
			setDampingVisible(next);
			if (typeof scene.setCameraRigOptions === "function") {
				scene.setCameraRigOptions({ enabled: next });
			}
		});
	}

	dampingInput.addEventListener("input", (event) => {
		const value = Number(event.target.value);
		if (!Number.isFinite(value) || value <= 0) return;

		if (typeof scene.setCameraRigOptions === "function") {
			scene.setCameraRigOptions({ damping: value });
		}

		if (dampingValue) {
			dampingValue.textContent = value.toFixed(1);
		}
	});
}

function setupFlowFieldControls(scene, flowOptions) {
	const influenceInput = document.getElementById("flow-influence");
	const strengthInput = document.getElementById("flow-strength");
	const frequencyInput = document.getElementById("flow-frequency");

	const influenceValue = document.getElementById("flow-influence-value");
	const strengthValue = document.getElementById("flow-strength-value");
	const frequencyValue = document.getElementById("flow-frequency-value");

	const hasAny =
		influenceInput || strengthInput || frequencyInput;
	if (!hasAny) return;

	const initialInfluence =
		typeof flowOptions.influence === "number"
			? flowOptions.influence
			: Number(influenceInput?.value ?? 0.5) || 0.5;
	const initialStrength =
		typeof flowOptions.strength === "number"
			? flowOptions.strength
			: Number(strengthInput?.value ?? 1.2) || 1.2;
	const initialFrequency =
		typeof flowOptions.frequency === "number"
			? flowOptions.frequency
			: Number(frequencyInput?.value ?? 0.5) || 0.5;

	if (influenceInput) influenceInput.value = String(initialInfluence);
	if (strengthInput) strengthInput.value = String(initialStrength);
	if (frequencyInput) frequencyInput.value = String(initialFrequency);

	if (influenceValue)
		influenceValue.textContent = initialInfluence.toFixed(2);
	if (strengthValue)
		strengthValue.textContent = initialStrength.toFixed(2);
	if (frequencyValue)
		frequencyValue.textContent = initialFrequency.toFixed(2);

	const applyFlow = (overrides = {}) => {
		const influence =
			typeof overrides.influence === "number"
				? overrides.influence
				: initialInfluence;
		const strength =
			typeof overrides.strength === "number"
				? overrides.strength
				: initialStrength;
		const frequency =
			typeof overrides.frequency === "number"
				? overrides.frequency
				: initialFrequency;

		if (typeof scene.setFlowFieldOptions === "function") {
			scene.setFlowFieldOptions({ influence, strength, frequency });
		}
	};

	applyFlow();

	if (influenceInput) {
		influenceInput.addEventListener("input", (event) => {
			const value = Number(event.target.value);
			if (!Number.isFinite(value)) return;
			if (influenceValue) {
				influenceValue.textContent = value.toFixed(2);
			}
			applyFlow({ influence: value });
		});
	}

	if (strengthInput) {
		strengthInput.addEventListener("input", (event) => {
			const value = Number(event.target.value);
			if (!Number.isFinite(value)) return;
			if (strengthValue) {
				strengthValue.textContent = value.toFixed(2);
			}
			applyFlow({ strength: value });
		});
	}

	if (frequencyInput) {
		frequencyInput.addEventListener("input", (event) => {
			const value = Number(event.target.value);
			if (!Number.isFinite(value) || value <= 0) return;
			if (frequencyValue) {
				frequencyValue.textContent = value.toFixed(2);
			}
			applyFlow({ frequency: value });
		});
	}
}

function setupUploadControls(scene) {
	const button = document.getElementById("ply-upload-button");
	const input = document.getElementById("ply-upload-input");
	const status = document.getElementById("upload-status");

	if (!button || !input) return;

	button.addEventListener("click", () => {
		input.click();
	});

	input.addEventListener("change", async (event) => {
		const file = event.target.files?.[0];
		if (!file) return;

		if (status) {
			status.textContent = `Preparing ${file.name}...`;
		}

		try {
			let result = null;
			if (typeof scene.loadPlyFromFile === "function") {
				result = await scene.loadPlyFromFile(file);
			}
			if (status) {
				const meta = result?.uploadMeta;
				if (meta?.converted) {
					const sampled =
						typeof meta.pointCount === "number"
							? `${meta.pointCount.toLocaleString()} points`
							: "point cloud";
					status.textContent = `Converted and loaded ${file.name} (${sampled})`;
				} else {
					status.textContent = `Loaded and fitted ${file.name}`;
				}
			}
		} catch (error) {
			console.error(error);
			if (status) {
				status.textContent = "Failed to load file. Please upload a valid .ply scene.";
			}
		} finally {
			event.target.value = "";
		}
	});
}
