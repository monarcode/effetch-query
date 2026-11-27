import { Link } from "@tanstack/react-router";
import * as Twoslash from "fumadocs-twoslash/ui";
import type { Components } from "hast-util-to-jsx-runtime";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import { X } from "lucide-react";
import {
	type ComponentProps,
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";

import type { LandingPanel, StageFacts } from "@/lib/landing-data";

import type { Beam, BeamScene, Ripple, Rgb } from "./beams";
import { Cache, type CacheEvent, TODOS, type Todo } from "./cache";

/** The simulation's clock runs this many times faster than the page's. */
const SPEED = 10;
/** How long a sweep of light takes to run along its line. */
const SWEEP = 0.65;
/** When the other components mount on their own, and the demo toggle runs. */
const SCRIPT = { open: 2, count: 2.8, toggle: 5.2 };

const LIME: Rgb = [0xd5 / 255, 0xf7 / 255, 0x0d / 255];
const PAPER: Rgb = [0xed / 255, 0xee / 255, 0xe8 / 255];

/** The components that read the query, in the order the page shows them. */
type Kind = "list" | "open" | "count";
const KINDS: readonly Kind[] = ["list", "open", "count"];

/** How a component got its first value. */
type Got = "fetch" | "join" | "cache";

interface Meter {
	readonly key: string;
	/** Seconds the value stays fresh, on the page's clock. */
	readonly duration: number;
	/** How far into it the value already is, as a negative delay. */
	readonly delay: number;
}

interface Snapshot {
	readonly staleIndex: number;
	readonly requests: number;
	readonly patches: number;
	readonly fetching: boolean;
	/** Whole seconds of freshness left, on the simulation's clock. */
	readonly freshFor: number;
	readonly meter: Meter | undefined;
	readonly readers: readonly {
		readonly id: number;
		readonly kind: Kind;
		readonly shown: number;
		readonly got: Got;
		readonly paused: boolean;
	}[];
	readonly values: Readonly<Record<number, readonly Todo[]>>;
	readonly pending: readonly number[];
}

/** The page as it's prerendered: the list, its value just fetched. */
function landed(staleSeconds: number): Snapshot {
	return {
		staleIndex: 0,
		requests: 1,
		patches: 0,
		fetching: false,
		freshFor: staleSeconds,
		meter: undefined,
		readers: [{ id: 0, kind: "list", shown: 1, got: "fetch", paused: false }],
		values: { 1: TODOS },
		pending: [],
	};
}

const StageContext = createContext<{
	readonly staleTime: string;
	readonly meter: Meter | undefined;
	readonly next: () => void;
} | null>(null);

/**
 * The code's `staleTime` value, which the visitor can change. Its
 * underline drains as the value's freshness runs out.
 */
function EditValue() {
	const stage = useContext(StageContext);
	if (!stage) return null;
	const { meter } = stage;
	return (
		<button
			type="button"
			className="stage-edit"
			onClick={stage.next}
			aria-label={`staleTime is "${stage.staleTime}". Change it`}
		>
			"{stage.staleTime}"
			<span className="stage-edit-meter" aria-hidden>
				{meter ? (
					<i
						key={meter.key}
						style={{
							animationDuration: `${meter.duration}s`,
							animationDelay: `${meter.delay}s`,
						}}
					/>
				) : null}
			</span>
		</button>
	);
}

// Every name is a hover target, so they stay out of the tab order, as in
// the docs: the code reads the same without its hovers.
function PopupTrigger(props: ComponentProps<typeof Twoslash.PopupTrigger>) {
	return <Twoslash.PopupTrigger {...props} tabIndex={-1} />;
}

const components = {
	...Twoslash,
	PopupTrigger,
	"stage-edit": EditValue,
} as Partial<Components>;

interface Controls {
	mount(kind: Kind): void;
	unmount(id: number): void;
	pause(id: number, paused: boolean): void;
	toggle(todo: number, done: boolean): void;
	invalidate(): void;
	next(): void;
}

/**
 * The hero: the docs' own query and the component reading it, running
 * against a simulated cache, with two more of the docs' components reading
 * the same query. The visitor toggles a todo, mounts and pauses the
 * components, changes `staleTime` or invalidates the query, and the
 * rendered output and the status bar answer. Light runs along the line
 * that executes, drawn with WebGL once the page has loaded.
 */
export function Stage({
	facts,
	panel,
	heading,
	children,
}: {
	facts: StageFacts;
	panel: LandingPanel;
	/** The title, beside the actions. */
	heading: ReactNode;
	children: ReactNode;
}) {
	const rootRef = useRef<HTMLElement>(null);
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const controlsRef = useRef<Controls | null>(null);
	const [snap, setSnap] = useState(() => landed(facts.staleTimes[0]!.seconds));
	const [live, setLive] = useState(false);

	useEffect(
		function runStage() {
			const root = rootRef.current;
			const light = canvasRef.current;
			if (!root || !light) return;
			const stage: HTMLElement = root;
			const canvas: HTMLCanvasElement = light;
			const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
			const start = performance.now();
			const clock = () => (performance.now() - start) / 1000;

			let staleIndex = 0;
			const cache = new Cache(facts.staleTimes[0]!.seconds / SPEED);
			// The prerendered state: the list, its value just fetched.
			cache.mount(0, "list");
			cache.tick(Number.POSITIVE_INFINITY);
			cache.landedAt = 0;
			const got = new Map<number, Got>([[0, "fetch"]]);
			let touched = false;

			let meter: Meter | undefined;
			let shown = "";
			function publish() {
				const now = clock();
				const fresh = cache.freshFor(now);
				const key = `${cache.version}:${staleIndex}:${cache.landedAt}`;
				if (cache.fetching || fresh === 0) meter = undefined;
				else if (meter?.key !== key)
					meter = {
						key,
						duration: cache.staleTime,
						delay: -(now - cache.landedAt),
					};
				const values: Record<number, readonly Todo[]> = {};
				for (const reader of cache.readers)
					values[reader.shown] = cache.values.get(reader.shown) ?? [];
				const next: Snapshot = {
					staleIndex,
					requests: cache.requests,
					patches: cache.patches,
					fetching: cache.fetching !== undefined,
					freshFor: Math.ceil(fresh * SPEED),
					meter,
					readers: cache.readers.map((reader) => ({
						id: reader.id,
						kind: reader.kind as Kind,
						shown: reader.shown,
						got: got.get(reader.id) ?? "cache",
						paused: reader.paused,
					})),
					values,
					pending: [...cache.pending.keys()],
				};
				const json = JSON.stringify(next);
				if (json === shown) return;
				shown = json;
				setSnap(next);
			}

			// Light: sweeps along the line that runs, and onto what it changes.
			interface Sweep {
				readonly at: number;
				readonly color: Rgb;
				readonly line: () => DOMRect | undefined;
				/** Sweeps the top edge of a box and ripples from it. */
				readonly box?: boolean;
			}
			let sweeps: Sweep[] = [];
			const textRect = (name: string) => () => {
				const element = stage.querySelector(
					`.stage-code [data-line="${name}"]`,
				);
				if (!element) return undefined;
				const range = document.createRange();
				range.selectNodeContents(element);
				return range.getBoundingClientRect();
			};
			const boxRect = (selector: string) => () =>
				stage.querySelector(selector)?.getBoundingClientRect();
			function sweep(
				line: Sweep["line"],
				color: Rgb,
				delay = 0,
				box = false,
			) {
				if (reduced) return;
				sweeps.push({ at: clock() + delay, color, line, box });
			}

			cache.on((event: CacheEvent) => {
				if (event.type === "fetch") sweep(textRect("read"), LIME);
				if (event.type === "land")
					cache.readers
						.filter((reader) => !reader.paused)
						.forEach((reader, i) =>
							sweep(
								boxRect(`[data-reader="${reader.id}"]`),
								LIME,
								i * 0.3,
								true,
							),
						);
				if (event.type === "cached") {
					sweep(textRect("read"), PAPER);
					sweep(
						boxRect(`[data-reader="${event.reader}"]`),
						LIME,
						0.25,
						true,
					);
				}
				if (event.type === "patch") {
					sweep(textRect("toggle"), LIME);
					sweep(boxRect(`[data-todo="${event.todo}"]`), PAPER, 0.1);
				}
				publish();
			});

			function mount(kind: Kind) {
				if (cache.readers.some((reader) => reader.kind === kind)) return;
				const how: Got =
					cache.version > 0 ? "cache" : cache.fetching ? "join" : "fetch";
				const reader = cache.mount(clock(), kind);
				got.set(reader.id, how);
				// Keep the page's order, whatever order they mount in.
				cache.readers.sort(
					(a, b) =>
						KINDS.indexOf(a.kind as Kind) - KINDS.indexOf(b.kind as Kind),
				);
				publish();
			}

			let scene: BeamScene | undefined;
			let frameId = 0;
			let timer = 0;
			let visible = true;
			let disposed = false;

			function draw() {
				const now = clock();
				cache.tick(now);
				publish();
				sweeps = sweeps.filter((s) => now - s.at < SWEEP * 1.6);
				if (!scene) return;
				const origin = canvas.getBoundingClientRect();
				const beams: Beam[] = [];
				const ripples: Ripple[] = [];
				for (const s of sweeps) {
					const t = (now - s.at) / SWEEP;
					const rect = s.line();
					if (t < 0 || !rect || rect.width === 0) continue;
					const x0 = rect.left - origin.left;
					const x1 = rect.right - origin.left;
					const y = (s.box ? rect.top : rect.bottom + 3) - origin.top;
					const w = x1 - x0;
					beams.push({
						points: [
							[x0, y],
							[x0 + w / 3, y],
							[x0 + (2 * w) / 3, y],
							[x1, y],
						],
						color: s.color,
						rest: 0,
						from: 0,
						to: 1,
						pulses: [
							{
								at: (1 - (1 - Math.min(1, t)) ** 3) * 1.4,
								length: 0.4,
								color: s.color,
							},
						],
					});
					if (s.box && t >= 0.5 && t < 1.5)
						ripples.push({
							box: {
								x: rect.left - origin.left,
								y: rect.top - origin.top,
								width: rect.width,
								height: rect.height,
							},
							at: t - 0.5,
							color: s.color,
						});
				}
				scene.render(beams, ripples, now);
			}

			function loop() {
				draw();
				frameId = requestAnimationFrame(loop);
			}

			function play() {
				stop();
				if (!visible || document.hidden) return;
				if (reduced) timer = window.setInterval(draw, 100);
				else frameId = requestAnimationFrame(loop);
			}

			function stop() {
				cancelAnimationFrame(frameId);
				window.clearInterval(timer);
			}

			function size() {
				const { width, height } = canvas.getBoundingClientRect();
				scene?.resize(width, height);
			}

			controlsRef.current = {
				mount(kind) {
					touched = true;
					mount(kind);
				},
				unmount(id) {
					touched = true;
					cache.unmount(id);
					publish();
				},
				pause(id, paused) {
					touched = true;
					cache.pause(clock(), id, paused);
					publish();
				},
				toggle(todo, done) {
					touched = true;
					cache.toggle(clock(), todo, done);
				},
				invalidate() {
					touched = true;
					cache.invalidate(clock());
					publish();
				},
				next() {
					touched = true;
					staleIndex = (staleIndex + 1) % facts.staleTimes.length;
					cache.staleTime = facts.staleTimes[staleIndex]!.seconds / SPEED;
					sweep(textRect("stale"), PAPER);
					publish();
				},
			};

			const resizer = new ResizeObserver(size);
			const watcher = new IntersectionObserver((entries) => {
				visible = entries.at(-1)?.isIntersecting ?? true;
				play();
			});

			function onVisibility() {
				// Coming back to the page refetches a stale value, as the
				// client's focus signal does. A fetch that was in flight lands
				// first, as it would have while the page was away.
				if (!document.hidden) {
					cache.tick(clock());
					cache.focus(clock());
				}
				play();
			}

			// The other components read the query a moment after the page
			// opens, from the cache; then, unless the visitor has started,
			// the list toggles a todo.
			const script = [
				window.setTimeout(() => mount("open"), SCRIPT.open * 1000),
				window.setTimeout(() => mount("count"), SCRIPT.count * 1000),
				window.setTimeout(() => {
					const todo = cache.values
						.get(cache.version)
						?.find((t) => !t.done);
					if (!touched && todo) cache.toggle(clock(), todo.id, !todo.done);
				}, SCRIPT.toggle * 1000),
			];

			resizer.observe(canvas);
			watcher.observe(stage);
			document.addEventListener("visibilitychange", onVisibility);
			setLive(true);
			play();

			// The light arrives when three.js does; the simulation doesn't
			// wait for it, and without motion it isn't loaded at all.
			if (!reduced)
				import("./beams")
					.then(({ createBeams }) => {
						if (disposed) return;
						try {
							scene = createBeams(canvas);
							size();
						} catch {
							// No WebGL: the page runs the same, without its light.
						}
					})
					.catch(() => {});

			return function stopStage() {
				disposed = true;
				stop();
				for (const id of script) window.clearTimeout(id);
				resizer.disconnect();
				watcher.disconnect();
				document.removeEventListener("visibilitychange", onVisibility);
				controlsRef.current = null;
				scene?.dispose();
			};
		},
		[facts],
	);

	const staleTime = facts.staleTimes[snap.staleIndex]!.text;
	const controls = () => controlsRef.current;
	// The code is the same every render; only its control reads the state.
	const code = useMemo(
		() => toJsxRuntime(panel.hast, { Fragment, jsx, jsxs, components }),
		[panel],
	);

	return (
		<section ref={rootRef} className="stage" aria-labelledby="stage-title">
			<canvas ref={canvasRef} className="stage-light" aria-hidden />
			<header className="stage-head">
				<div className="stage-heading">{heading}</div>
				<div className="stage-actions">{children}</div>
			</header>

			<div className="stage-run">
				<figure className="stage-code">
					<StageContext
						value={{
							staleTime,
							meter: snap.meter,
							next: () => controls()?.next(),
						}}
					>
						{code}
					</StageContext>
					<figcaption>
						From{" "}
						<Link
							to="/docs/$"
							params={{
								_splat: panel.page.href.replace(/^\/docs\/?/, ""),
							}}
						>
							{panel.page.title}
						</Link>
						, in the docs. Click a todo to run the mutation, or{" "}
						<code>"{staleTime}"</code> to change it. Hover a name for its
						type.
					</figcaption>
				</figure>

				<section className="stage-app" aria-label="What the code renders">
					<header className="stage-app-head">
						<h2>Three components, one cache entry</h2>
						<code>{facts.key}</code>
					</header>
					<div className="stage-mounts">
						{KINDS.map((kind) => {
							const reader = snap.readers.find(
								(each) => each.kind === kind,
							);
							return (
								<Mounted
									key={kind}
									kind={kind}
									facts={facts}
									reader={reader}
									value={
										reader ? snap.values[reader.shown] : undefined
									}
									waiting={snap.fetching && !reader?.paused}
									pending={snap.pending}
									live={live}
									controls={controls}
								/>
							);
						})}
					</div>
				</section>
			</div>

			<div className="stage-status">
				<span
					className="stage-running"
					data-live={live || undefined}
					data-busy={snap.fetching || snap.pending.length > 0 || undefined}
				>
					Simulated, {SPEED}× speed
				</span>
				<span>
					key <b>{facts.key}</b>
				</span>
				<span aria-live="polite">
					{facts.request} <b key={snap.requests}>×{snap.requests}</b>
				</span>
				<span>
					{facts.mutation} <b key={snap.patches}>×{snap.patches}</b>
				</span>
				<span className="stage-freshness" data-state={freshness(snap)}>
					{snap.fetching
						? "fetching"
						: snap.freshFor > 0
							? `fresh for ${snap.freshFor}s`
							: "stale"}
				</span>
				<span>
					readers{" "}
					<b>{snap.readers.filter((reader) => !reader.paused).length}</b>
				</span>
				<button
					type="button"
					className="stage-invalidate"
					disabled={!live || snap.fetching}
					onClick={() => controls()?.invalidate()}
				>
					Run <code>{facts.invalidate}</code>
				</button>
			</div>
		</section>
	);
}

function freshness(snap: Snapshot) {
	return snap.fetching ? "fetching" : snap.freshFor > 0 ? "fresh" : "stale";
}

const GOT: Record<Got, string> = {
	fetch: "fetched it",
	join: "joined the fetch",
	cache: "read the cache",
};

/** One of the components, mounted or not. */
function Mounted({
	kind,
	facts,
	reader,
	value,
	waiting,
	pending,
	live,
	controls,
}: {
	kind: Kind;
	facts: StageFacts;
	reader: Snapshot["readers"][number] | undefined;
	value: readonly Todo[] | undefined;
	waiting: boolean;
	pending: readonly number[];
	live: boolean;
	controls: () => Controls | null;
}) {
	const name =
		kind === "list"
			? "Todos"
			: kind === "open"
				? facts.readers.open.name
				: facts.readers.count.name;
	const tag = <code>{`<${name} />`}</code>;
	if (!reader)
		return (
			<div className="stage-mount" data-kind={kind}>
				<button
					type="button"
					disabled={!live}
					onClick={() => controls()?.mount(kind)}
				>
					Mount {tag}
				</button>
			</div>
		);
	return (
		<article
			className="stage-reader"
			data-kind={kind}
			data-reader={reader.id}
			data-waiting={waiting || undefined}
			data-paused={reader.paused || undefined}
			aria-label={name}
		>
			<header className="stage-reader-head">
				{tag}
				<span className="stage-reader-got">
					{reader.paused
						? "paused"
						: waiting
							? "refetching"
							: GOT[reader.got]}
				</span>
				<button
					type="button"
					className="stage-unmount"
					aria-label={`Unmount ${name}`}
					onClick={() => controls()?.unmount(reader.id)}
				>
					<X aria-hidden className="size-3.5" />
				</button>
			</header>
			{value === undefined || reader.shown === 0 ? (
				<p className="stage-reader-body">{facts.loading}</p>
			) : kind === "list" ? (
				<ul className="stage-todos">
					{value.map((todo) => {
						const busy = pending.includes(todo.id);
						return (
							<li key={todo.id} data-todo={todo.id}>
								<button
									type="button"
									data-done={todo.done || undefined}
									data-busy={busy || undefined}
									disabled={!live || busy}
									onClick={() =>
										controls()?.toggle(todo.id, !todo.done)
									}
									aria-label={`${todo.title}: ${todo.done ? "done" : "open"}. Toggle it`}
								>
									<span className="stage-check" aria-hidden>
										{todo.done ? "✓" : "○"}
									</span>
									<span className="stage-todo-title">
										{todo.title}
									</span>
									{busy ? (
										<span className="stage-todo-busy">
											{facts.mutation.split(" ")[0]}
										</span>
									) : null}
								</button>
							</li>
						);
					})}
				</ul>
			) : (
				<div className="stage-number">
					<b key={count(kind, value)}>{count(kind, value)}</b>{" "}
					{kind === "open"
						? facts.readers.open.label
						: facts.readers.count.label}
					{kind === "count" ? (
						<label className="stage-switch">
							<input
								type="checkbox"
								checked={!reader.paused}
								onChange={(event) =>
									controls()?.pause(reader.id, !event.target.checked)
								}
							/>
							<span>Screen focused</span>
						</label>
					) : null}
				</div>
			)}
		</article>
	);
}

function count(kind: Kind, value: readonly Todo[]) {
	return kind === "open"
		? value.filter((todo) => !todo.done).length
		: value.length;
}
