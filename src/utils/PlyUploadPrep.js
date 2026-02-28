import * as THREE from "three";
import { PLYLoader as ThreePlyLoader } from "three/examples/jsm/loaders/PLYLoader.js";

const SH_C0 = 0.28209479177387814;
const MIN_TARGET_POINTS = 250000;
const MAX_TARGET_POINTS = 1200000;
const FIT_TARGET_MAX_DIM = 8.0;
const FIT_TARGET_CENTER = { x: 0, y: 0, z: -8 };

function clamp01(v) {
	return Math.max(0, Math.min(1, v));
}

function toDc(v) {
	return (v - 0.5) / SH_C0;
}

function findHeaderEnd(bytes) {
	const lf = "end_header\n";
	const crlf = "end_header\r\n";

	for (let i = 0; i < Math.min(bytes.length, 65536); i++) {
		let ok = true;
		for (let j = 0; j < lf.length; j++) {
			if (bytes[i + j] !== lf.charCodeAt(j)) {
				ok = false;
				break;
			}
		}
		if (ok) return { endIndex: i, markerLength: lf.length };
	}

	for (let i = 0; i < Math.min(bytes.length, 65536); i++) {
		let ok = true;
		for (let j = 0; j < crlf.length; j++) {
			if (bytes[i + j] !== crlf.charCodeAt(j)) {
				ok = false;
				break;
			}
		}
		if (ok) return { endIndex: i, markerLength: crlf.length };
	}

	return null;
}

function inspectPlyHeader(buffer) {
	const bytes = new Uint8Array(buffer);
	const headerEnd = findHeaderEnd(bytes);
	if (!headerEnd) return { validPly: false };

	const text = new TextDecoder().decode(bytes.subarray(0, headerEnd.endIndex));
	const lines = text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);

	if (lines[0] !== "ply") return { validPly: false };

	const formatLine = lines.find((line) => line.startsWith("format "));
	const isBinaryLE = formatLine?.includes("binary_little_endian") ?? false;

	let inVertex = false;
	let vertexCount = 0;
	const props = [];
	let offset = 0;
	const typeSizes = {
		float: 4,
		double: 8,
		int: 4,
		uint: 4,
		short: 2,
		ushort: 2,
		char: 1,
		uchar: 1,
	};
	for (const line of lines) {
		const parts = line.split(/\s+/);
		if (parts[0] === "element") {
			inVertex = parts[1] === "vertex";
			if (inVertex) {
				vertexCount = Number(parts[2]);
				offset = 0;
			}
			continue;
		}
		if (inVertex && parts[0] === "property" && parts[1] !== "list") {
			const type = parts[1];
			const name = parts[2];
			const size = typeSizes[type] ?? 4;
			props.push({ type, name, offset, size });
			offset += size;
		}
	}

	const names = new Set(props.map((p) => p.name));
	const hasXYZ = names.has("x") && names.has("y") && names.has("z");
	const hasDc =
		names.has("f_dc_0") && names.has("f_dc_1") && names.has("f_dc_2");
	const xyzFloat = ["x", "y", "z"].every(
		(k) => props.find((p) => p.name === k)?.type === "float",
	);
	const dcFloat = ["f_dc_0", "f_dc_1", "f_dc_2"].every(
		(k) => props.find((p) => p.name === k)?.type === "float",
	);

	return {
		validPly: true,
		isBinaryLE,
		headerByteLength: headerEnd.endIndex,
		headerMarkerLength: headerEnd.markerLength,
		hasXYZ,
		hasDc,
		xyzFloat,
		dcFloat,
		vertexCount,
		vertexStride: offset,
		vertexProperties: props,
		compatibleMin:
			isBinaryLE && hasXYZ && hasDc && xyzFloat && dcFloat && headerEnd.endIndex <= 4096,
	};
}

function computeBoundsFromGeometry(geometry) {
	geometry.computeBoundingBox();
	const bb = geometry.boundingBox;
	if (!bb) return null;
	return {
		min: { x: bb.min.x, y: bb.min.y, z: bb.min.z },
		max: { x: bb.max.x, y: bb.max.y, z: bb.max.z },
	};
}

function computeBoundsFromBinaryPly(buffer, header) {
	if (!header?.isBinaryLE || !header?.vertexCount || !header?.vertexProperties?.length) {
		return null;
	}

	const xProp = header.vertexProperties.find((p) => p.name === "x");
	const yProp = header.vertexProperties.find((p) => p.name === "y");
	const zProp = header.vertexProperties.find((p) => p.name === "z");
	if (!xProp || !yProp || !zProp) return null;

	const dataStart = header.headerByteLength + header.headerMarkerLength;
	const view = new DataView(buffer, dataStart);
	const stride = header.vertexStride;
	const count = header.vertexCount;

	let minX = Infinity;
	let minY = Infinity;
	let minZ = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	let maxZ = -Infinity;

	for (let i = 0; i < count; i++) {
		const base = i * stride;
		const x = view.getFloat32(base + xProp.offset, true);
		const y = view.getFloat32(base + yProp.offset, true);
		const z = view.getFloat32(base + zProp.offset, true);

		if (x < minX) minX = x;
		if (y < minY) minY = y;
		if (z < minZ) minZ = z;
		if (x > maxX) maxX = x;
		if (y > maxY) maxY = y;
		if (z > maxZ) maxZ = z;
	}

	return {
		min: { x: minX, y: minY, z: minZ },
		max: { x: maxX, y: maxY, z: maxZ },
	};
}

function computeAutoFit(bounds) {
	if (!bounds) return null;

	const sizeX = bounds.max.x - bounds.min.x;
	const sizeY = bounds.max.y - bounds.min.y;
	const sizeZ = bounds.max.z - bounds.min.z;
	const maxDim = Math.max(sizeX, sizeY, sizeZ);
	const scale = maxDim > 0 ? FIT_TARGET_MAX_DIM / maxDim : 1;

	const cx = (bounds.min.x + bounds.max.x) * 0.5;
	const cy = (bounds.min.y + bounds.max.y) * 0.5;
	const cz = (bounds.min.z + bounds.max.z) * 0.5;

	const rotation = chooseFacingRotation(bounds);
	const center = new THREE.Vector3(cx, cy, cz);
	const rotatedScaledCenter = center
		.multiplyScalar(scale)
		.applyEuler(new THREE.Euler(rotation.x, rotation.y, rotation.z, "XYZ"));

	return {
		scale,
		rotation,
		position: {
			x: FIT_TARGET_CENTER.x - rotatedScaledCenter.x,
			y: FIT_TARGET_CENTER.y - rotatedScaledCenter.y,
			z: FIT_TARGET_CENTER.z - rotatedScaledCenter.z,
		},
	};
}

function chooseFacingRotation(bounds) {
	const sizeX = bounds.max.x - bounds.min.x;
	const sizeY = bounds.max.y - bounds.min.y;
	const sizeZ = bounds.max.z - bounds.min.z;
	const dims = [
		{ axis: "x", size: sizeX },
		{ axis: "y", size: sizeY },
		{ axis: "z", size: sizeZ },
	].sort((a, b) => a.size - b.size);
	const upAxis = dims[0].axis;

	// Heuristic:
	// - smallest extent is usually "up" for scanned/meshed scenes
	// - rotate so up-axis becomes +Y, which matches this camera rig
	if (upAxis === "z") {
		return { x: -Math.PI / 2, y: 0, z: 0 };
	}
	if (upAxis === "x") {
		return { x: 0, y: 0, z: Math.PI / 2 };
	}

	// Y-up already: keep front-facing default orientation.
	return { x: 0, y: 0, z: 0 };
}

function inferTargetPoints(positionCount) {
	if (positionCount <= 0) return MIN_TARGET_POINTS;
	if (positionCount >= MAX_TARGET_POINTS) return MAX_TARGET_POINTS;
	if (positionCount < MIN_TARGET_POINTS) return MIN_TARGET_POINTS;
	return positionCount;
}

function getColorArray(geometry) {
	const colorAttr = geometry.getAttribute("color");
	if (!colorAttr) return null;

	const out = new Float32Array(colorAttr.count * 3);
	for (let i = 0; i < colorAttr.count; i++) {
		out[i * 3 + 0] = clamp01(colorAttr.getX(i));
		out[i * 3 + 1] = clamp01(colorAttr.getY(i));
		out[i * 3 + 2] = clamp01(colorAttr.getZ(i));
	}
	return out;
}

function getVertexColor(colors, i) {
	if (!colors) return { r: 1, g: 1, b: 1 };
	return {
		r: colors[i * 3 + 0],
		g: colors[i * 3 + 1],
		b: colors[i * 3 + 2],
	};
}

function triangleArea(positions, a, b, c) {
	const ax = positions[a * 3 + 0];
	const ay = positions[a * 3 + 1];
	const az = positions[a * 3 + 2];
	const bx = positions[b * 3 + 0];
	const by = positions[b * 3 + 1];
	const bz = positions[b * 3 + 2];
	const cx = positions[c * 3 + 0];
	const cy = positions[c * 3 + 1];
	const cz = positions[c * 3 + 2];

	const abx = bx - ax;
	const aby = by - ay;
	const abz = bz - az;
	const acx = cx - ax;
	const acy = cy - ay;
	const acz = cz - az;

	const x = aby * acz - abz * acy;
	const y = abz * acx - abx * acz;
	const z = abx * acy - aby * acx;
	return 0.5 * Math.hypot(x, y, z);
}

function pickTriangle(cumulativeAreas, totalArea) {
	const target = Math.random() * totalArea;
	let lo = 0;
	let hi = cumulativeAreas.length - 1;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (cumulativeAreas[mid] < target) lo = mid + 1;
		else hi = mid;
	}
	return lo;
}

function encodeMinPly(points) {
	const header = [
		"ply",
		"format binary_little_endian 1.0",
		`element vertex ${points.length}`,
		"property float x",
		"property float y",
		"property float z",
		"property float f_dc_0",
		"property float f_dc_1",
		"property float f_dc_2",
		"end_header\n",
	].join("\n");

	const headerBytes = new TextEncoder().encode(header);
	const data = new Float32Array(points.length * 6);
	for (let i = 0; i < points.length; i++) {
		const p = points[i];
		const o = i * 6;
		data[o + 0] = p.x;
		data[o + 1] = p.y;
		data[o + 2] = p.z;
		data[o + 3] = p.dc0;
		data[o + 4] = p.dc1;
		data[o + 5] = p.dc2;
	}

	const out = new Uint8Array(headerBytes.length + data.byteLength);
	out.set(headerBytes, 0);
	out.set(new Uint8Array(data.buffer), headerBytes.length);
	return out.buffer;
}

function sampleMeshToPointCloud(geometry, targetPoints) {
	const positionAttr = geometry.getAttribute("position");
	if (!positionAttr) {
		throw new Error("PLY has no position attribute");
	}

	const positions = positionAttr.array;
	const colors = getColorArray(geometry);
	const indexAttr = geometry.getIndex();

	if (!indexAttr || indexAttr.count < 3) {
		const count = Math.min(targetPoints, positionAttr.count);
		const points = new Array(count);
		for (let i = 0; i < count; i++) {
			const c = getVertexColor(colors, i);
			points[i] = {
				x: positions[i * 3 + 0],
				y: positions[i * 3 + 1],
				z: positions[i * 3 + 2],
				dc0: toDc(c.r),
				dc1: toDc(c.g),
				dc2: toDc(c.b),
			};
		}
		return { points, method: "vertices" };
	}

	const indices = indexAttr.array;
	const triCount = Math.floor(indices.length / 3);
	const cumulativeAreas = new Float64Array(triCount);
	let totalArea = 0;

	for (let t = 0; t < triCount; t++) {
		const i0 = indices[t * 3 + 0];
		const i1 = indices[t * 3 + 1];
		const i2 = indices[t * 3 + 2];
		totalArea += triangleArea(positions, i0, i1, i2);
		cumulativeAreas[t] = totalArea;
	}

	if (totalArea <= 0) {
		const count = Math.min(targetPoints, positionAttr.count);
		const points = new Array(count);
		for (let i = 0; i < count; i++) {
			const c = getVertexColor(colors, i);
			points[i] = {
				x: positions[i * 3 + 0],
				y: positions[i * 3 + 1],
				z: positions[i * 3 + 2],
				dc0: toDc(c.r),
				dc1: toDc(c.g),
				dc2: toDc(c.b),
			};
		}
		return { points, method: "vertices" };
	}

	const points = new Array(targetPoints);
	for (let i = 0; i < targetPoints; i++) {
		const tri = pickTriangle(cumulativeAreas, totalArea);
		const i0 = indices[tri * 3 + 0];
		const i1 = indices[tri * 3 + 1];
		const i2 = indices[tri * 3 + 2];

		const u = Math.random();
		const v = Math.random();
		const su = Math.sqrt(u);
		const w0 = 1 - su;
		const w1 = su * (1 - v);
		const w2 = su * v;

		const x =
			w0 * positions[i0 * 3 + 0] +
			w1 * positions[i1 * 3 + 0] +
			w2 * positions[i2 * 3 + 0];
		const y =
			w0 * positions[i0 * 3 + 1] +
			w1 * positions[i1 * 3 + 1] +
			w2 * positions[i2 * 3 + 1];
		const z =
			w0 * positions[i0 * 3 + 2] +
			w1 * positions[i1 * 3 + 2] +
			w2 * positions[i2 * 3 + 2];

		const c0 = getVertexColor(colors, i0);
		const c1 = getVertexColor(colors, i1);
		const c2 = getVertexColor(colors, i2);
		const r = clamp01(w0 * c0.r + w1 * c1.r + w2 * c2.r);
		const g = clamp01(w0 * c0.g + w1 * c1.g + w2 * c2.g);
		const b = clamp01(w0 * c0.b + w1 * c1.b + w2 * c2.b);

		points[i] = { x, y, z, dc0: toDc(r), dc1: toDc(g), dc2: toDc(b) };
	}

	return { points, method: "surface" };
}

export async function prepareUploadedPly(file) {
	if (!file) throw new Error("No file provided");
	const name = file.name || "";
	if (!name.toLowerCase().endsWith(".ply")) {
		throw new Error("Only .ply files are supported.");
	}

	const buffer = await file.arrayBuffer();
	const header = inspectPlyHeader(buffer);
	if (!header.validPly) {
		throw new Error("File is not a valid PLY.");
	}

	if (header.compatibleMin) {
		const bounds = computeBoundsFromBinaryPly(buffer, header);
		return {
			buffer,
			converted: false,
			pointCount: header.vertexCount,
			method: "native",
			fit: computeAutoFit(bounds),
		};
	}

	const loader = new ThreePlyLoader();
	const geometry = loader.parse(buffer);
	if (!(geometry instanceof THREE.BufferGeometry)) {
		throw new Error("Failed to parse PLY geometry.");
	}

	const positionAttr = geometry.getAttribute("position");
	if (!positionAttr) {
		geometry.dispose();
		throw new Error("PLY geometry is missing positions.");
	}
	const bounds = computeBoundsFromGeometry(geometry);

	const targetPoints = inferTargetPoints(positionAttr.count);
	const { points, method } = sampleMeshToPointCloud(geometry, targetPoints);
	geometry.dispose();

	return {
		buffer: encodeMinPly(points),
		converted: true,
		pointCount: points.length,
		method,
		fit: computeAutoFit(bounds),
	};
}
