import * as THREE from "three";
import WebGLContext from "../core/WebGLContext";
import PlyLoader from "../utils/PlyLoader";
import { CameraRig } from "../utils/CameraRig";

export default class Scene {
	constructor() {
		this.context = null;
		this.camera = null;
		this.cameraRig = null;
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
		this.cameraRig && this.cameraRig.update(delta);
		this.plyLoader && this.plyLoader.update(delta, elapsed);
	}

	onResize(width, height) {
		this.width = width;
		this.height = height;
		this.aspectRatio = width / height;

		this.camera.aspect = this.aspectRatio;
		this.camera.updateProjectionMatrix();

		this.plyLoader && this.plyLoader.onResize(width, height);
	}

	setCameraRigOptions(options = {}) {
		if (!this.cameraRig) return;

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

		const name = file.name || "";
		if (!name.toLowerCase().endsWith(".ply")) {
			throw new Error("Only .ply files are supported for scenery upload.");
		}

		const buffer = await file.arrayBuffer();

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
					points.rotation.x = Math.PI;
					this.plyPoints = points;
					this.scene.add(points);
					resolve(points);
				},
				onError: (error) => {
					console.error("PLY upload error:", error);
					reject(error);
				},
			});
		});
	}
}
