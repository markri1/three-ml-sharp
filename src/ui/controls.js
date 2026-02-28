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

	setupCameraControls(scene, cameraOptions);
	setupFlowFieldControls(scene, flowOptions);
	setupUploadControls(scene);
}

function setupCameraControls(scene, cameraOptions) {
	const dampingInput = document.getElementById("camera-damping");
	const dampingValue = document.getElementById("camera-damping-value");

	if (!dampingInput) return;

	const initialDamping =
		typeof cameraOptions.damping === "number"
			? cameraOptions.damping
			: Number(dampingInput.value) || 2;

	dampingInput.value = String(initialDamping);
	if (dampingValue) {
		dampingValue.textContent = initialDamping.toFixed(1);
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
			status.textContent = `Loading ${file.name}...`;
		}

		try {
			if (typeof scene.loadPlyFromFile === "function") {
				await scene.loadPlyFromFile(file);
			}
			if (status) {
				status.textContent = `Loaded ${file.name}`;
			}
		} catch (error) {
			console.error(error);
			if (status) {
				status.textContent =
					"Failed to load file. Please use a preprocessed .min.ply.";
			}
		} finally {
			event.target.value = "";
		}
	});
}

