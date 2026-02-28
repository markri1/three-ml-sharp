#!/usr/bin/env node
import { readFileSync, writeFileSync } from "fs";
import { basename, resolve } from "path";

const SH_C0 = 0.28209479177387814;

const TYPE_INFO = {
	char: { size: 1, read: "readInt8", write: "writeInt8" },
	int8: { size: 1, read: "readInt8", write: "writeInt8" },
	uchar: { size: 1, read: "readUInt8", write: "writeUInt8" },
	uint8: { size: 1, read: "readUInt8", write: "writeUInt8" },
	short: { size: 2, read: "readInt16LE", write: "writeInt16LE" },
	int16: { size: 2, read: "readInt16LE", write: "writeInt16LE" },
	ushort: { size: 2, read: "readUInt16LE", write: "writeUInt16LE" },
	uint16: { size: 2, read: "readUInt16LE", write: "writeUInt16LE" },
	int: { size: 4, read: "readInt32LE", write: "writeInt32LE" },
	int32: { size: 4, read: "readInt32LE", write: "writeInt32LE" },
	uint: { size: 4, read: "readUInt32LE", write: "writeUInt32LE" },
	uint32: { size: 4, read: "readUInt32LE", write: "writeUInt32LE" },
	float: { size: 4, read: "readFloatLE", write: "writeFloatLE" },
	float32: { size: 4, read: "readFloatLE", write: "writeFloatLE" },
	double: { size: 8, read: "readDoubleLE", write: "writeDoubleLE" },
	float64: { size: 8, read: "readDoubleLE", write: "writeDoubleLE" },
};

function parseArgs(argv) {
	const positional = [];
	const flags = new Map();

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg.startsWith("--")) {
			const [k, inline] = arg.split("=", 2);
			if (inline !== undefined) {
				flags.set(k, inline);
			} else {
				const next = argv[i + 1];
				if (!next || next.startsWith("--")) {
					flags.set(k, "true");
				} else {
					flags.set(k, next);
					i++;
				}
			}
		} else {
			positional.push(arg);
		}
	}

	return { positional, flags };
}

function normalizeType(type) {
	return String(type || "").trim().toLowerCase();
}

function getTypeInfo(type) {
	const info = TYPE_INFO[normalizeType(type)];
	if (!info) {
		throw new Error(`Unsupported PLY property type: ${type}`);
	}
	return info;
}

function findHeaderEnd(buffer) {
	const markerLF = Buffer.from("end_header\n");
	const markerCRLF = Buffer.from("end_header\r\n");
	const iLF = buffer.indexOf(markerLF);
	const iCRLF = buffer.indexOf(markerCRLF);

	if (iLF !== -1 && (iCRLF === -1 || iLF < iCRLF)) {
		return { index: iLF, length: markerLF.length };
	}
	if (iCRLF !== -1) {
		return { index: iCRLF, length: markerCRLF.length };
	}
	throw new Error("Could not find end_header marker in PLY file");
}

function parseHeader(headerText) {
	const lines = headerText
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);

	if (lines[0] !== "ply") {
		throw new Error("Not a PLY file (missing leading 'ply' line)");
	}

	const formatLine = lines.find((line) => line.startsWith("format "));
	if (!formatLine) {
		throw new Error("PLY header missing format line");
	}

	const formatParts = formatLine.split(/\s+/);
	const format = formatParts[1];
	const version = formatParts[2];

	const elements = [];
	let currentElement = null;

	for (const line of lines) {
		const parts = line.split(/\s+/);
		if (parts[0] === "element") {
			currentElement = {
				name: parts[1],
				count: Number(parts[2]),
				properties: [],
			};
			elements.push(currentElement);
			continue;
		}

		if (parts[0] === "property" && currentElement) {
			if (parts[1] === "list") {
				currentElement.properties.push({
					kind: "list",
					countType: parts[2],
					itemType: parts[3],
					name: parts[4],
				});
			} else {
				currentElement.properties.push({
					kind: "scalar",
					type: parts[1],
					name: parts[2],
				});
			}
		}
	}

	return { format, version, elements };
}

function readScalar(buffer, offset, type) {
	const info = getTypeInfo(type);
	return {
		value: buffer[info.read](offset),
		nextOffset: offset + info.size,
	};
}

function parsePly(inputPath) {
	const filePath = resolve(inputPath);
	const buffer = readFileSync(filePath);
	const { index: headerEnd, length: headerMarkerLen } = findHeaderEnd(buffer);
	const headerText = buffer.subarray(0, headerEnd).toString("utf8");
	const header = parseHeader(headerText);
	const dataStart = headerEnd + headerMarkerLen;

	if (header.format !== "ascii" && header.format !== "binary_little_endian") {
		throw new Error(
			`Unsupported PLY format '${header.format}'. Only ascii and binary_little_endian are supported.`,
		);
	}

	const data = {};

	if (header.format === "ascii") {
		const text = buffer.subarray(dataStart).toString("utf8");
		const lines = text
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter(Boolean);
		let lineIndex = 0;

		for (const element of header.elements) {
			const rows = [];
			for (let i = 0; i < element.count; i++) {
				if (lineIndex >= lines.length) {
					throw new Error(
						`Unexpected end of ascii data while reading element '${element.name}'.`,
					);
				}
				const tokens = lines[lineIndex].split(/\s+/);
				lineIndex++;

				const row = {};
				let tokenIndex = 0;
				for (const prop of element.properties) {
					if (prop.kind === "scalar") {
						row[prop.name] = Number(tokens[tokenIndex++]);
					} else {
						const count = Number(tokens[tokenIndex++]);
						const values = [];
						for (let j = 0; j < count; j++) {
							values.push(Number(tokens[tokenIndex++]));
						}
						row[prop.name] = values;
					}
				}
				rows.push(row);
			}
			data[element.name] = rows;
		}
	} else {
		let offset = dataStart;
		for (const element of header.elements) {
			const rows = [];
			for (let i = 0; i < element.count; i++) {
				const row = {};
				for (const prop of element.properties) {
					if (prop.kind === "scalar") {
						const result = readScalar(buffer, offset, prop.type);
						row[prop.name] = result.value;
						offset = result.nextOffset;
					} else {
						const c = readScalar(buffer, offset, prop.countType);
						offset = c.nextOffset;
						const count = Number(c.value);
						const values = new Array(count);
						for (let j = 0; j < count; j++) {
							const item = readScalar(buffer, offset, prop.itemType);
							values[j] = Number(item.value);
							offset = item.nextOffset;
						}
						row[prop.name] = values;
					}
				}
				rows.push(row);
			}
			data[element.name] = rows;
		}
	}

	return { filePath, buffer, header, headerEnd, dataStart, data };
}

function findVertexProperties(vertexElement) {
	const byName = new Map(vertexElement.properties.map((p) => [p.name, p]));
	const has = (name) => byName.has(name);

	const x = has("x") ? "x" : null;
	const y = has("y") ? "y" : null;
	const z = has("z") ? "z" : null;

	const red = has("red") ? "red" : has("r") ? "r" : null;
	const green = has("green") ? "green" : has("g") ? "g" : null;
	const blue = has("blue") ? "blue" : has("b") ? "b" : null;

	const dc0 = has("f_dc_0") ? "f_dc_0" : null;
	const dc1 = has("f_dc_1") ? "f_dc_1" : null;
	const dc2 = has("f_dc_2") ? "f_dc_2" : null;

	return {
		hasPosition: !!(x && y && z),
		position: { x, y, z },
		rgb: { red, green, blue, has: !!(red && green && blue) },
		dc: { dc0, dc1, dc2, has: !!(dc0 && dc1 && dc2) },
	};
}

function clamp01(v) {
	return Math.max(0, Math.min(1, v));
}

function detectColorScale(vertices, rgbKeys) {
	let max = 0;
	for (let i = 0; i < Math.min(vertices.length, 2048); i++) {
		const v = vertices[i];
		max = Math.max(max, Number(v[rgbKeys.red] ?? 0));
		max = Math.max(max, Number(v[rgbKeys.green] ?? 0));
		max = Math.max(max, Number(v[rgbKeys.blue] ?? 0));
	}
	return max > 1.0001 ? 255 : 1;
}

function toDcColor(rgb01) {
	return (rgb01 - 0.5) / SH_C0;
}

function chooseFaceIndex(cumulativeAreas, totalArea, rnd) {
	const target = rnd * totalArea;
	let lo = 0;
	let hi = cumulativeAreas.length - 1;

	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (cumulativeAreas[mid] < target) lo = mid + 1;
		else hi = mid;
	}
	return lo;
}

function triangleArea(a, b, c) {
	const abx = b.x - a.x;
	const aby = b.y - a.y;
	const abz = b.z - a.z;
	const acx = c.x - a.x;
	const acy = c.y - a.y;
	const acz = c.z - a.z;

	const cx = aby * acz - abz * acy;
	const cy = abz * acx - abx * acz;
	const cz = abx * acy - aby * acx;
	return 0.5 * Math.hypot(cx, cy, cz);
}

function writeMinPly(outPath, points) {
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

	const headerBuf = Buffer.from(header, "utf8");
	const stride = 24;
	const data = Buffer.alloc(points.length * stride);

	for (let i = 0; i < points.length; i++) {
		const base = i * stride;
		const p = points[i];
		data.writeFloatLE(p.x, base + 0);
		data.writeFloatLE(p.y, base + 4);
		data.writeFloatLE(p.z, base + 8);
		data.writeFloatLE(p.dc0, base + 12);
		data.writeFloatLE(p.dc1, base + 16);
		data.writeFloatLE(p.dc2, base + 20);
	}

	writeFileSync(outPath, Buffer.concat([headerBuf, data]));
}

function validateCommand(inputPath) {
	const parsed = parsePly(inputPath);
	const { header, buffer, headerEnd } = parsed;
	const vertexEl = header.elements.find((e) => e.name === "vertex");

	if (!vertexEl) {
		console.error("Invalid: missing 'vertex' element");
		process.exitCode = 2;
		return;
	}

	const vProps = findVertexProperties(vertexEl);
	const byName = new Map(vertexEl.properties.map((p) => [p.name, p]));

	const xType = byName.get("x")?.type;
	const yType = byName.get("y")?.type;
	const zType = byName.get("z")?.type;
	const dcTypes = ["f_dc_0", "f_dc_1", "f_dc_2"].map((k) => byName.get(k)?.type);

	const gpgpuSize = Math.ceil(Math.sqrt(vertexEl.count));
	const gpgpuPx = gpgpuSize * gpgpuSize;

	const report = [];
	report.push(`File: ${basename(parsed.filePath)}`);
	report.push(`Format: ${header.format} ${header.version}`);
	report.push(`Vertices: ${vertexEl.count.toLocaleString()}`);
	report.push(`Header bytes before end_header: ${headerEnd}`);
	report.push(`File size: ${(buffer.length / 1024 / 1024).toFixed(2)} MiB`);
	report.push("");
	report.push("Compatibility checks with current loader:");
	report.push(
		`- format binary_little_endian: ${header.format === "binary_little_endian" ? "OK" : "FAIL"}`,
	);
	report.push(`- vertex has x,y,z: ${vProps.hasPosition ? "OK" : "FAIL"}`);
	report.push(
		`- x/y/z are float32: ${xType === "float" && yType === "float" && zType === "float" ? "OK" : "FAIL"}`,
	);
	report.push(
		`- f_dc_0/1/2 present: ${vProps.dc.has ? "OK" : "WARN (will render white if missing)"}`,
	);
	if (vProps.dc.has) {
		const allFloat = dcTypes.every((t) => t === "float");
		report.push(`- f_dc_0/1/2 are float32: ${allFloat ? "OK" : "FAIL"}`);
	}
	report.push(`- header <= 4096 bytes: ${headerEnd <= 4096 ? "OK" : "FAIL"}`);
	report.push("");
	report.push("Runtime estimate:");
	report.push(`- GPGPU texture: ${gpgpuSize} x ${gpgpuSize} (${gpgpuPx.toLocaleString()} texels)`);
	report.push(`- Approx compute textures memory: ${(gpgpuPx * 4 * 4 * 2 / 1024 / 1024).toFixed(2)} MiB`);
	report.push(`- Approx CPU particle arrays: ${(vertexEl.count * 9 * 4 / 1024 / 1024).toFixed(2)} MiB`);
	report.push("");
	report.push("Tip: for this project, a preprocessed .min.ply with x/y/z/f_dc_0/1/2 is ideal.");

	console.log(report.join("\n"));

	const hardFail =
		header.format !== "binary_little_endian" ||
		!vProps.hasPosition ||
		xType !== "float" ||
		yType !== "float" ||
		zType !== "float" ||
		headerEnd > 4096 ||
		(vProps.dc.has && dcTypes.some((t) => t !== "float"));

	if (hardFail) {
		process.exitCode = 2;
	}
}

function convertCommand(inputPath, outputPath, sampleCountRaw) {
	const parsed = parsePly(inputPath);
	const { header, data } = parsed;
	const vertexEl = header.elements.find((e) => e.name === "vertex");
	if (!vertexEl) {
		throw new Error("Input PLY has no vertex element");
	}

	const verticesRaw = data.vertex || [];
	if (!verticesRaw.length) {
		throw new Error("Input PLY has zero vertices");
	}

	const props = findVertexProperties(vertexEl);
	if (!props.hasPosition) {
		throw new Error("Input vertex element must have x,y,z properties");
	}

	const vertices = verticesRaw.map((v) => ({
		x: Number(v[props.position.x]),
		y: Number(v[props.position.y]),
		z: Number(v[props.position.z]),
		...v,
	}));

	const hasVertexRgb = props.rgb.has;
	const hasVertexDc = props.dc.has;
	const rgbScale = hasVertexRgb ? detectColorScale(verticesRaw, props.rgb) : 1;

	const getVertexColor01 = (v) => {
		if (hasVertexDc) {
			return {
				r: clamp01(0.5 + SH_C0 * Number(v[props.dc.dc0])),
				g: clamp01(0.5 + SH_C0 * Number(v[props.dc.dc1])),
				b: clamp01(0.5 + SH_C0 * Number(v[props.dc.dc2])),
			};
		}
		if (hasVertexRgb) {
			return {
				r: clamp01(Number(v[props.rgb.red]) / rgbScale),
				g: clamp01(Number(v[props.rgb.green]) / rgbScale),
				b: clamp01(Number(v[props.rgb.blue]) / rgbScale),
			};
		}
		return { r: 1, g: 1, b: 1 };
	};

	const defaultSamples = vertices.length;
	const sampleCount = sampleCountRaw ? Number(sampleCountRaw) : defaultSamples;
	if (!Number.isFinite(sampleCount) || sampleCount <= 0) {
		throw new Error(`Invalid sample count '${sampleCountRaw}'`);
	}
	const samples = Math.floor(sampleCount);

	const faceRows = data.face || [];
	const faceIndexName =
		faceRows.length > 0
			? Object.keys(faceRows[0]).find((k) =>
				["vertex_indices", "vertex_index", "vertices"].includes(k),
			)
			: null;

	const points = [];

	if (!faceRows.length || !faceIndexName) {
		for (let i = 0; i < Math.min(samples, vertices.length); i++) {
			const v = vertices[i];
			const c = getVertexColor01(v);
			points.push({
				x: v.x,
				y: v.y,
				z: v.z,
				dc0: toDcColor(c.r),
				dc1: toDcColor(c.g),
				dc2: toDcColor(c.b),
			});
		}
		console.log(
			"No mesh faces detected; exported existing vertices as point cloud (no surface resampling).",
		);
	} else {
		const triangles = [];
		for (const f of faceRows) {
			const idx = f[faceIndexName];
			if (!Array.isArray(idx) || idx.length < 3) continue;
			for (let i = 1; i < idx.length - 1; i++) {
				triangles.push([idx[0], idx[i], idx[i + 1]]);
			}
		}

		if (!triangles.length) {
			throw new Error("No valid triangles found in face data");
		}

		const cumulativeAreas = new Float64Array(triangles.length);
		let totalArea = 0;
		for (let i = 0; i < triangles.length; i++) {
			const [ia, ib, ic] = triangles[i];
			const a = vertices[ia];
			const b = vertices[ib];
			const c = vertices[ic];
			if (!a || !b || !c) continue;
			const area = triangleArea(a, b, c);
			totalArea += area;
			cumulativeAreas[i] = totalArea;
		}

		if (totalArea <= 0) {
			throw new Error("Mesh has zero total surface area");
		}

		for (let i = 0; i < samples; i++) {
			const triIndex = chooseFaceIndex(cumulativeAreas, totalArea, Math.random());
			const [ia, ib, ic] = triangles[triIndex];
			const a = vertices[ia];
			const b = vertices[ib];
			const c = vertices[ic];

			const u = Math.random();
			const v = Math.random();
			const su = Math.sqrt(u);
			const w0 = 1 - su;
			const w1 = su * (1 - v);
			const w2 = su * v;

			const x = w0 * a.x + w1 * b.x + w2 * c.x;
			const y = w0 * a.y + w1 * b.y + w2 * c.y;
			const z = w0 * a.z + w1 * b.z + w2 * c.z;

			const ca = getVertexColor01(a);
			const cb = getVertexColor01(b);
			const cc = getVertexColor01(c);

			const r = clamp01(w0 * ca.r + w1 * cb.r + w2 * cc.r);
			const g = clamp01(w0 * ca.g + w1 * cb.g + w2 * cc.g);
			const bColor = clamp01(w0 * ca.b + w1 * cb.b + w2 * cc.b);

			points.push({ x, y, z, dc0: toDcColor(r), dc1: toDcColor(g), dc2: toDcColor(bColor) });
		}
	}

	const outPath = resolve(
		outputPath || inputPath.replace(/\.ply$/i, ".min.ply").replace(/\.min\.ply$/i, ".min.ply"),
	);
	writeMinPly(outPath, points);
	console.log(`Wrote ${points.length.toLocaleString()} points to ${outPath}`);
}

function usage() {
	console.log(`PLY tools\n\nUsage:\n  node scripts/ply-tools.mjs validate <input.ply>\n  node scripts/ply-tools.mjs convert-mesh <input.ply> [--output out.min.ply] [--samples 1200000]\n\nNotes:\n  - convert-mesh resamples mesh surfaces (face element) into points and writes a binary .min.ply.\n  - If no face element exists, convert-mesh exports existing vertices as points.`);
}

function main() {
	const { positional, flags } = parseArgs(process.argv.slice(2));
	const command = positional[0];
	const input = positional[1];

	if (!command || command === "-h" || command === "--help") {
		usage();
		return;
	}

	if (!input) {
		usage();
		process.exitCode = 1;
		return;
	}

	if (command === "validate") {
		validateCommand(input);
		return;
	}

	if (command === "convert-mesh") {
		convertCommand(input, flags.get("--output"), flags.get("--samples"));
		return;
	}

	usage();
	process.exitCode = 1;
}

main();
