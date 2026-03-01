import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import WebGLContext from "../core/WebGLContext";
import PlyLoader from "../utils/PlyLoader";
import { CameraRig } from "../utils/CameraRig";
import { prepareUploadedPly } from "../utils/PlyUploadPrep";

export default class Scene {
	constructor() {
		this.context = null;
		this.camera = null;
		this.cameraRig = null;
		this.orbitControls = null;
		this.width = 0;
		this.height = 0;
		this.aspectRatio = 0;
		this.scene = null;
		this.envMap = null;
		this.plyLoader = null;
		this.plyPoints = null;
		this.flowFieldOptions = {
			influence: 0.5,
			strength: 1.2,
			frequency: 0.5,
		};
		this.#init();
	}

	async #init() {
		this.#setContext();
		this.#setupScene();
		this.#setupCamera();
		this.#setupCameraRig();
		this.#setupManualCameraControls();
		await this.#addObjects();
	}

	#setContext() {
		this.context = new WebGLContext();
	}

	#setupScene() {
		this.scene = new THREE.Scene();
		this.scene.background = new THREE.Color(0x000000);
		this.scene.fog = new THREE.Fog(0x000000, 40.0, 45.0);
	}

	#setupCamera() {
		this.#calculateAspectRatio();
		this.camera = new THREE.PerspectiveCamera(45, this.aspectRatio, 0.01, 1000);
		this.camera.position.z = 3;
	}

	#setupCameraRig() {
		this.cameraRig = new CameraRig(this.camera, {
			target: new THREE.Vector3(0, 0, 0),
			xLimit: [-10.25, 10.25],
			yLimit: [-1.25, 0.25],
			target: new THREE.Vector3(0, 0, -5),
			damping: 2.0,
		});
	}

	#setupManualCameraControls() {
		const domElement = this.context?.renderer?.domElement;
		if (!domElement) return;

		this.orbitControls = new OrbitControls(this.camera, domElement);
		this.orbitControls.enableDamping = true;
		this.orbitControls.dampingFactor = 0.08;
		this.orbitControls.enableRotate = true;
		this.orbitControls.enablePan = true;
		this.orbitControls.enableZoom = true;
		this.orbitControls.minDistance = 0.5;
		this.orbitControls.maxDistance = 200;
		this.orbitControls.target.copy(
			this.cameraRig?.target ?? new THREE.Vector3(0, 0, -5),
		);
		this.orbitControls.enabled = false;
		this.orbitControls.update();
	}

	#setManualCameraEnabled(enabled) {
		if (this.orbitControls) {
			this.orbitControls.enabled = enabled;
			if (enabled) {
				this.orbitControls.update();
			}
		}

		const canvas = this.context?.canvas;
		if (canvas) {
			canvas.style.pointerEvents = enabled ? "auto" : "none";
		}
	}

	async #addObjects() {
		this.plyLoader = new PlyLoader(`${import.meta.env.BASE_URL}tokyo.min.ply`, {
			renderer: this.context.renderer,
			size: 0.05,
			flowFieldInfluence: this.flowFieldOptions.influence,
			flowFieldStrength: this.flowFieldOptions.strength,
			flowFieldFrequency: this.flowFieldOptions.frequency,
			onProgress: (progress) => {
				const pct = Math.round(progress * 100);
				const bar = document.getElementById("loader-bar");
				if (bar) bar.style.width = `${pct}%`;
			},
			onLoad: (points) => {
				points.rotation.x = Math.PI;
				this.plyPoints = points;
				this.scene.add(points);
				const loader = document.getElementById("loader");
				if (loader) {
					loader.style.opacity = "0";
					setTimeout(() => loader.remove(), 700);
				}
			},
		});
	}

	#calculateAspectRatio() {
		const { width, height } = this.context.getFullScreenDimensions();
		this.width = width;
		this.height = height;
		this.aspectRatio = this.width / this.height;
	}

	animate(delta, elapsed) {
		if (this.cameraRig?.enabled) {
			this.cameraRig.update(delta);
		} else if (this.orbitControls?.enabled) {
			this.orbitControls.update();
		}
		this.plyLoader && this.plyLoader.update(delta, elapsed);
	}

	onResize(width, height) {
		this.width = width;
		this.height = height;
		this.aspectRatio = width / height;

		this.camera.aspect = this.aspectRatio;
		this.camera.updateProjectionMatrix();

		if (this.orbitControls) {
			this.orbitControls.update();
		}
		this.plyLoader && this.plyLoader.onResize(width, height);
	}

	setCameraRigOptions(options = {}) {
		if (!this.cameraRig) return;

		if (typeof options.enabled === "boolean") {
			this.cameraRig.setEnabled(options.enabled);
			this.#setManualCameraEnabled(!options.enabled);
			if (!options.enabled && this.orbitControls && this.cameraRig?.target) {
				this.orbitControls.target.copy(this.cameraRig.target);
				this.orbitControls.update();
			}
		}

		if (typeof options.damping === "number") {
			this.cameraRig.setDamping(options.damping);
		}

		if (Array.isArray(options.xLimit) || Array.isArray(options.yLimit)) {
			this.cameraRig.setLimits({
				xLimit: options.xLimit ?? this.cameraRig.xLimit,
				yLimit: options.yLimit ?? this.cameraRig.yLimit,
			});
		}

		if (options.target instanceof THREE.Vector3) {
			this.cameraRig.setTarget(options.target);
			if (this.orbitControls) {
				this.orbitControls.target.copy(options.target);
				if (this.orbitControls.enabled) this.orbitControls.update();
			}
		}
	}

	setFlowFieldOptions(options = {}) {
		this.flowFieldOptions = {
			influence:
				typeof options.influence === "number"
					? options.influence
					: this.flowFieldOptions.influence,
			strength:
				typeof options.strength === "number"
					? options.strength
					: this.flowFieldOptions.strength,
			frequency:
				typeof options.frequency === "number"
					? options.frequency
					: this.flowFieldOptions.frequency,
		};

		if (this.plyLoader && typeof this.plyLoader.setFlowField === "function") {
			this.plyLoader.setFlowField({
				influence: this.flowFieldOptions.influence,
				strength: this.flowFieldOptions.strength,
				frequency: this.flowFieldOptions.frequency,
			});
		}
	}

	getCameraRigOptions() {
		return {
			enabled: this.cameraRig?.enabled ?? true,
			damping: this.cameraRig?.damping ?? 2.0,
			xLimit: this.cameraRig?.xLimit ?? [-10.25, 10.25],
			yLimit: this.cameraRig?.yLimit ?? [-1.25, 0.25],
		};
	}

	getFlowFieldOptions() {
		return { ...this.flowFieldOptions };
	}

	async loadPlyFromFile(file) {
		if (!file) return;
		const prepared = await prepareUploadedPly(file);
		const buffer = prepared.buffer;

		if (this.plyLoader) {
			if (this.plyPoints) {
				this.scene.remove(this.plyPoints);
				this.plyPoints = null;
			} else if (this.plyLoader.points) {
				this.scene.remove(this.plyLoader.points);
			}
			this.plyLoader.dispose();
			this.plyLoader = null;
		}

		return new Promise((resolve, reject) => {
			this.plyLoader = new PlyLoader(buffer, {
				renderer: this.context.renderer,
				size: 0.05,
				flowFieldInfluence: this.flowFieldOptions.influence,
				flowFieldStrength: this.flowFieldOptions.strength,
				flowFieldFrequency: this.flowFieldOptions.frequency,
				onLoad: (points) => {
					const fit = prepared?.fit;
					if (fit) {
						if (
							fit.rotation &&
							typeof fit.rotation.x === "number" &&
							typeof fit.rotation.y === "number" &&
							typeof fit.rotation.z === "number"
						) {
							points.rotation.set(
								fit.rotation.x,
								fit.rotation.y,
								fit.rotation.z,
							);
						}
						if (typeof fit.scale === "number" && Number.isFinite(fit.scale)) {
							points.scale.setScalar(fit.scale);
						}
						if (
							fit.position &&
							typeof fit.position.x === "number" &&
							typeof fit.position.y === "number" &&
							typeof fit.position.z === "number"
						) {
							points.position.set(
								fit.position.x,
								fit.position.y,
								fit.position.z,
							);
						}
					} else {
						points.rotation.x = Math.PI;
					}
					this.plyPoints = points;
					this.scene.add(points);
					resolve({ points, uploadMeta: prepared });
				},
				onError: (error) => {
					console.error("PLY upload error:", error);
					reject(error);
				},
			});
		});
	}
}
