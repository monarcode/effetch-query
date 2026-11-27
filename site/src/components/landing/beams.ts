import {
	BufferAttribute,
	BufferGeometry,
	ColorManagement,
	DoubleSide,
	LinearSRGBColorSpace,
	Mesh,
	NormalBlending,
	OrthographicCamera,
	PlaneGeometry,
	Scene,
	ShaderMaterial,
	Vector2,
	Vector3,
	Vector4,
	WebGLRenderer,
} from "three";

/*
 * The landing page's beams: light along a curve between two parts of the
 * scene, drawn with WebGL. Loaded only in the browser, after the page shows,
 * so the prerendered page and every docs page go without three.js.
 *
 * Colours are written to the screen as the sRGB values they're given, with
 * no colour management, and a beam's core blends normally, so a lit core is
 * exactly #D5F70D.
 */

ColorManagement.enabled = false;

export type Rgb = readonly [number, number, number];

export const LIME: Rgb = [0xd5 / 255, 0xf7 / 255, 0x0d / 255];
export const PAPER: Rgb = [0xed / 255, 0xee / 255, 0xe8 / 255];
export const STALE: Rgb = [0x5b / 255, 0x5f / 255, 0x6b / 255];

/** Light travelling along a beam. */
export interface Pulse {
	/** Where its head is, from 0 at the beam's start to 1 at its end. */
	readonly at: number;
	/** How much of the beam its tail covers. */
	readonly length: number;
	readonly color: Rgb;
	/** True when it travels from the end back to the start. */
	readonly back?: boolean | undefined;
}

export type Point = readonly [x: number, y: number];

/** One beam for one frame. */
export interface Beam {
	/** The curve's four control points, in CSS pixels from the top left. */
	readonly points: readonly [Point, Point, Point, Point];
	readonly color: Rgb;
	/** How lit the beam is at rest, 0 to 1. */
	readonly rest: number;
	/** The part that's drawn, 0 to 1 along it, as it draws on or off. */
	readonly from: number;
	readonly to: number;
	readonly pulses?: readonly Pulse[] | undefined;
	/** Light running along the beam at rest, as on a live stream. */
	readonly flow?: boolean | undefined;
}

/** Light spreading from a node's edge as something reaches it. */
export interface Ripple {
	/** The node's box, in CSS pixels from the top left. */
	readonly box: {
		readonly x: number;
		readonly y: number;
		readonly width: number;
		readonly height: number;
	};
	/** How far it has spread, 0 to 1. */
	readonly at: number;
	readonly color: Rgb;
}

export interface BeamScene {
	/** Draws the beams and ripples; `time` runs the light, in seconds. */
	render(
		beams: readonly Beam[],
		ripples: readonly Ripple[],
		time: number,
	): void;
	resize(width: number, height: number): void;
	dispose(): void;
}

const SEGMENTS = 160;
const MAX_BEAMS = 16;
const MAX_PULSES = 3;
const MAX_RIPPLES = 8;
/** How far a ripple spreads beyond its node, in pixels. */
const SPREAD = 8;
/** How far a beam's glow reaches from its centre, in pixels. */
const REACH = 14;

const vertex = /* glsl */ `
attribute float aT;
attribute float aSide;
uniform vec2 uP0;
uniform vec2 uP1;
uniform vec2 uP2;
uniform vec2 uP3;
varying float vT;
varying float vAcross;

vec2 curve(float t) {
	float s = 1.0 - t;
	return s * s * s * uP0 + 3.0 * s * s * t * uP1 + 3.0 * s * t * t * uP2 + t * t * t * uP3;
}

vec2 slope(float t) {
	float s = 1.0 - t;
	return 3.0 * s * s * (uP1 - uP0) + 6.0 * s * t * (uP2 - uP1) + 3.0 * t * t * (uP3 - uP2);
}

void main() {
	vec2 d = slope(aT);
	if (length(d) < 0.0001) d = uP3 - uP0;
	vec2 normal = normalize(vec2(-d.y, d.x));
	vT = aT;
	vAcross = aSide * ${REACH.toFixed(1)};
	vec2 position = curve(aT) + normal * vAcross;
	gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 0.0, 1.0);
}
`;

const fragment = /* glsl */ `
uniform vec3 uColor;
uniform float uRest;
uniform vec2 uDraw;
uniform float uTime;
uniform float uFlow;
uniform float uLength;
uniform vec4 uPulse[${MAX_PULSES}];
uniform vec3 uPulseColor[${MAX_PULSES}];
varying float vT;
varying float vAcross;

void main() {
	if (vT < uDraw.x || vT > uDraw.y) discard;
	float across = abs(vAcross);
	float aa = max(fwidth(vAcross), 0.0001);

	vec3 color = uColor;
	float light = uRest;

	// Light runs along a beam at rest: faintly on every beam, and brightly
	// on a live stream.
	float live = step(0.5, uFlow);
	float band = fract(vT * uLength / mix(220.0, 70.0, live) - uTime * mix(0.35, 1.6, live));
	light = max(light, uRest + mix(0.35 * uRest, 0.55, live) * pow(1.0 - band, 8.0));

	// A beam drawing on leads with a bright tip.
	if (uDraw.y < 0.999) {
		float tip = clamp(1.0 - (uDraw.y - vT) * uLength / 60.0, 0.0, 1.0);
		light = max(light, tip * tip);
	}

	float head = 0.0;
	for (int i = 0; i < ${MAX_PULSES}; i++) {
		vec4 pulse = uPulse[i];
		if (pulse.x < 0.0) continue;
		float behind = pulse.z > 0.5 ? vT - pulse.x : pulse.x - vT;
		if (behind < 0.0 || behind > pulse.y) continue;
		float k = 1.0 - behind / pulse.y;
		k *= k;
		if (k > light) color = mix(color, uPulseColor[i], k);
		light = max(light, k);
		head = max(head, clamp(1.0 - behind * uLength / 10.0, 0.0, 1.0));
	}

	// A crisp core, a little wider where it's lit, and a short glow.
	float width = 0.7 + 0.9 * light + 1.4 * head;
	float core = 1.0 - smoothstep(width - aa, width + aa, across);
	float glow = exp(-across * across / (18.0 + 40.0 * head)) * (0.22 + 0.5 * head);
	float alpha = min(1.0, core * light + glow * light);
	if (alpha < 0.003) discard;
	gl_FragColor = vec4(color, alpha);
}
`;

// A ripple: the outline of its node's box, growing and fading.
const rippleVertex = /* glsl */ `
varying vec2 vUv;
void main() {
	vUv = uv;
	gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const rippleFragment = /* glsl */ `
uniform vec2 uSize;
uniform vec2 uHalf;
uniform float uAt;
uniform vec3 uColor;
varying vec2 vUv;

float box(vec2 p, vec2 extent, float radius) {
	vec2 q = abs(p) - extent + radius;
	return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
}

void main() {
	vec2 p = (vUv - 0.5) * uSize;
	float grow = uAt * ${SPREAD.toFixed(1)};
	float d = box(p, uHalf + grow, 6.0 + 0.25 * grow);
	float width = 0.7 + 0.5 * uAt;
	float ring = exp(-d * d / (2.0 * width * width));
	float alpha = ring * pow(1.0 - uAt, 1.6);
	if (alpha < 0.003) discard;
	gl_FragColor = vec4(uColor, alpha);
}
`;

function stripGeometry() {
	const count = (SEGMENTS + 1) * 2;
	const t = new Float32Array(count);
	const side = new Float32Array(count);
	for (let i = 0; i <= SEGMENTS; i++) {
		t[i * 2] = t[i * 2 + 1] = i / SEGMENTS;
		side[i * 2] = -1;
		side[i * 2 + 1] = 1;
	}
	const index: number[] = [];
	for (let i = 0; i < SEGMENTS; i++) {
		const a = i * 2;
		index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
	}
	const geometry = new BufferGeometry();
	// Positions come from the curve in the shader; three needs the attribute.
	geometry.setAttribute(
		"position",
		new BufferAttribute(new Float32Array(count * 3), 3),
	);
	geometry.setAttribute("aT", new BufferAttribute(t, 1));
	geometry.setAttribute("aSide", new BufferAttribute(side, 1));
	geometry.setIndex(index);
	return geometry;
}

/** A curve's length in pixels, near enough to space its light evenly. */
function curveLength([p0, p1, p2, p3]: Beam["points"]) {
	let length = 0;
	let [x, y] = p0;
	for (let i = 1; i <= 24; i++) {
		const t = i / 24;
		const s = 1 - t;
		const a = s * s * s;
		const b = 3 * s * s * t;
		const c = 3 * s * t * t;
		const d = t * t * t;
		const nx = a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0];
		const ny = a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1];
		length += Math.hypot(nx - x, ny - y);
		x = nx;
		y = ny;
	}
	return length;
}

export function createBeams(canvas: HTMLCanvasElement): BeamScene {
	const renderer = new WebGLRenderer({
		canvas,
		antialias: true,
		alpha: true,
		powerPreference: "high-performance",
	});
	renderer.outputColorSpace = LinearSRGBColorSpace;
	renderer.setClearColor(0x000000, 0);

	const scene = new Scene();
	// One unit is one CSS pixel, with y running up from the bottom.
	const camera = new OrthographicCamera(0, 1, 1, 0, -1, 1);
	let height = 1;
	const geometry = stripGeometry();

	const pool = Array.from({ length: MAX_BEAMS }, () => {
		const uniforms = {
			uP0: { value: new Vector2() },
			uP1: { value: new Vector2() },
			uP2: { value: new Vector2() },
			uP3: { value: new Vector2() },
			uColor: { value: new Vector3() },
			uRest: { value: 0 },
			uDraw: { value: new Vector2(0, 1) },
			uTime: { value: 0 },
			uFlow: { value: 0 },
			uLength: { value: 1 },
			uPulse: {
				value: Array.from(
					{ length: MAX_PULSES },
					() => new Vector4(-1, 0, 0, 0),
				),
			},
			uPulseColor: {
				value: Array.from({ length: MAX_PULSES }, () => new Vector3()),
			},
		};
		const mesh = new Mesh(
			geometry,
			new ShaderMaterial({
				uniforms,
				vertexShader: vertex,
				fragmentShader: fragment,
				transparent: true,
				depthWrite: false,
				depthTest: false,
				blending: NormalBlending,
				// The strip's winding follows the curve, so either face may show.
				side: DoubleSide,
			}),
		);
		mesh.frustumCulled = false;
		mesh.visible = false;
		scene.add(mesh);
		return { mesh, uniforms };
	});

	const plane = new PlaneGeometry(1, 1);
	const ripplePool = Array.from({ length: MAX_RIPPLES }, () => {
		const uniforms = {
			uSize: { value: new Vector2() },
			uHalf: { value: new Vector2() },
			uAt: { value: 0 },
			uColor: { value: new Vector3() },
		};
		const mesh = new Mesh(
			plane,
			new ShaderMaterial({
				uniforms,
				vertexShader: rippleVertex,
				fragmentShader: rippleFragment,
				transparent: true,
				depthWrite: false,
				depthTest: false,
			}),
		);
		mesh.frustumCulled = false;
		mesh.visible = false;
		mesh.renderOrder = 1;
		scene.add(mesh);
		return { mesh, uniforms };
	});

	const flip = ([x, y]: Point, into: Vector2) => into.set(x, height - y);

	return {
		render(beams, ripples, time) {
			ripplePool.forEach(({ mesh, uniforms }, i) => {
				const ripple = ripples[i];
				mesh.visible =
					ripple !== undefined && ripple.at >= 0 && ripple.at < 1;
				if (!ripple || !mesh.visible) return;
				const { x, y, width, height: tall } = ripple.box;
				const margin = SPREAD + 12;
				mesh.position.set(x + width / 2, height - (y + tall / 2), 0);
				mesh.scale.set(width + margin * 2, tall + margin * 2, 1);
				uniforms.uSize.value.set(width + margin * 2, tall + margin * 2);
				uniforms.uHalf.value.set(width / 2, tall / 2);
				uniforms.uAt.value = ripple.at;
				uniforms.uColor.value.set(...ripple.color);
			});
			pool.forEach(({ mesh, uniforms }, i) => {
				const beam = beams[i];
				mesh.visible = beam !== undefined && beam.to > beam.from;
				if (!beam || !mesh.visible) return;
				const [p0, p1, p2, p3] = beam.points;
				flip(p0, uniforms.uP0.value);
				flip(p1, uniforms.uP1.value);
				flip(p2, uniforms.uP2.value);
				flip(p3, uniforms.uP3.value);
				uniforms.uColor.value.set(...beam.color);
				uniforms.uRest.value = beam.rest;
				uniforms.uDraw.value.set(beam.from, beam.to);
				uniforms.uTime.value = time;
				uniforms.uFlow.value = beam.flow ? 1 : 0;
				uniforms.uLength.value = Math.max(1, curveLength(beam.points));
				for (let p = 0; p < MAX_PULSES; p++) {
					const pulse = beam.pulses?.[p];
					uniforms.uPulse.value[p]!.set(
						pulse ? pulse.at : -1,
						pulse ? Math.max(0.001, pulse.length) : 0,
						pulse?.back ? 1 : 0,
						0,
					);
					if (pulse) uniforms.uPulseColor.value[p]!.set(...pulse.color);
				}
			});
			renderer.render(scene, camera);
		},
		resize(w, h) {
			height = h;
			renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
			renderer.setSize(w, h, false);
			camera.right = w;
			camera.top = h;
			camera.updateProjectionMatrix();
		},
		dispose() {
			geometry.dispose();
			plane.dispose();
			for (const { mesh } of [...pool, ...ripplePool])
				(mesh.material as ShaderMaterial).dispose();
			renderer.dispose();
		},
	};
}
