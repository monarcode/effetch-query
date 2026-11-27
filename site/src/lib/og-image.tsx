/**
 * The link-preview images, drawn with Takumi in the stage's world: void,
 * paper and muted grey, Geist and Geist Mono, with lime for the mark and
 * the value. Import it from server code only.
 */
import geistMonoExt from "@fontsource-variable/geist-mono/files/geist-mono-latin-ext-wght-normal.woff2?inline";
import geistMono from "@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2?inline";
import geistExt from "@fontsource-variable/geist/files/geist-latin-ext-wght-normal.woff2?inline";
import geist from "@fontsource-variable/geist/files/geist-latin-wght-normal.woff2?inline";
import type { ReactNode } from "react";
import { render } from "takumi-js";

import { CHANNELS } from "@/components/landing/effect-band";
import { HEADLINE } from "@/components/landing/landing";

import { IMAGE_AS_BASE64, OG_SIZE } from "./og";
import { SITE_URL } from "./shared";

const VOID = "#0c0d11";
const INK = "#16171d";
const PAPER = "#edeee8";
const MUTED = "#a2a6b0";
const NOTE = "#868a95";
const LIME = "#d5f70d";
const RULE = "#262832";

/** The bytes of a font Vite inlined as a data URL. */
const fontData = (dataUrl: string) =>
	Uint8Array.from(atob(dataUrl.slice(dataUrl.indexOf(",") + 1)), (c) =>
		c.charCodeAt(0),
	);

/**
 * Geist and Geist Mono, every weight, each with its Latin Extended subset
 * as the fallback for the accented letters the Latin one lacks.
 */
const FONTS = [
	{ name: "Geist Variable", data: fontData(geist) },
	{ name: "Geist Ext", data: fontData(geistExt) },
	{ name: "Geist Mono Variable", data: fontData(geistMono) },
	{ name: "Geist Mono Ext", data: fontData(geistMonoExt) },
];

const SANS = "Geist Variable, Geist Ext";
const MONO = { fontFamily: "Geist Mono Variable, Geist Mono Ext" } as const;

/** The site's host, as a reader would type it. */
const HOST = SITE_URL.replace(/^https?:\/\//, "");

/** What every image says the package is, as the home page's title does. */
const TAGLINE = "Server state for Effect";

/**
 * How many characters of mono note fit beside the tagline at the foot: a
 * longer page URL takes the whole line.
 */
const FOOT_ROOM = 50;

/**
 * The longest title and description a docs image has room for: two lines
 * of title at its smallest size, and three of description.
 */
const TITLE_ROOM = 60;
const DESCRIPTION_ROOM = 160;

/**
 * The brace-and-dot, in lime, as `favicon.svg` draws it. `padded` keeps
 * the favicon's margins, which centre it in a square; without them its
 * dot lines up with the text beside it.
 */
function Mark({ height, padded }: { height: number; padded?: boolean }) {
	const [x, width] = padded ? [0, 389] : [70, 249];
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox={`${x} 0 ${width} 447`}
			width={(height * width) / 447}
			height={height}
		>
			<path
				fill={LIME}
				d="M228.706 310.99L139.78 301.061L158.113 319.394L228.506 349.98C226.34 387.533 210.479 411.042 180.922 420.506L189.796 446.674C216.343 439.089 236.443 426.726 250.096 409.584C263.9 392.442 270.803 369.612 270.803 341.093V295.128C270.803 258.266 286.883 239.834 319.042 239.834V206.84C286.883 206.84 270.803 188.712 270.803 152.456V104.672C270.651 76.6074 263.824 54.0803 250.323 37.0901C236.822 19.9483 216.646 7.58491 189.796 1.52588e-05L181.149 26.1679C212.854 36.3317 228.706 62.8029 228.706 105.582V151.774C228.706 187.119 242.435 211.012 269.892 223.451C242.435 236.194 228.706 260.086 228.706 295.128V310.99Z"
			/>
			<path
				fill={LIME}
				d="M154.676 135.876C154.676 159.227 135.746 178.156 112.396 178.156C89.0455 178.156 70.1162 159.227 70.1162 135.876C70.1162 112.526 89.0455 93.5968 112.396 93.5968C135.746 93.5968 154.676 112.526 154.676 135.876Z"
			/>
		</svg>
	);
}

/**
 * The frame every image shares: the wordmark and a mono label across the
 * top, the content, and a hairline over two mono notes at the foot.
 */
function Frame({
	label,
	foot,
	children,
}: {
	label?: string | undefined;
	foot: [string, string | undefined];
	children: ReactNode;
}) {
	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				width: "100%",
				height: "100%",
				padding: "60px 72px 56px",
				backgroundColor: VOID,
				color: PAPER,
				fontFamily: SANS,
				fontWeight: 400,
			}}
		>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
				}}
			>
				<div style={{ display: "flex", alignItems: "center", gap: 16 }}>
					<Mark height={44} />
					<span
						style={{
							fontSize: 34,
							fontWeight: 600,
							letterSpacing: "-0.02em",
						}}
					>
						Effetch Query
					</span>
				</div>
				{label && (
					<span style={{ ...MONO, fontSize: 22, color: NOTE }}>
						{label}
					</span>
				)}
			</div>
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					flexGrow: 1,
					justifyContent: "flex-end",
				}}
			>
				{children}
			</div>
			<div
				style={{
					...MONO,
					display: "flex",
					justifyContent: "space-between",
					marginTop: 44,
					paddingTop: 22,
					borderTop: `2px solid ${RULE}`,
					fontSize: 22,
					color: NOTE,
				}}
			>
				<span>{foot[0]}</span>
				{foot[1] && <span>{foot[1]}</span>}
			</div>
		</div>
	);
}

/**
 * A docs page's image: where it sits in the docs, its title set as the
 * stage sets a headline, and its description in grey.
 */
export function DocsImage({
	section,
	title,
	description,
	path,
}: {
	section: string;
	title: string;
	description: string;
	path: string;
}) {
	// Longer text runs out of the frame, which the build would ship unseen.
	if (title.length > TITLE_ROOM || description.length > DESCRIPTION_ROOM)
		throw new Error(
			`${path}: a link-preview image fits a title of ${TITLE_ROOM} characters and a description of ${DESCRIPTION_ROOM}. Shorten the page's frontmatter.`,
		);
	const url = `${HOST}${path}`;
	// Short titles set larger, so one word doesn't sit small in the frame.
	const size = title.length <= 22 ? 96 : title.length <= 36 ? 82 : 68;
	return (
		<Frame
			label={section}
			foot={[url, url.length <= FOOT_ROOM ? TAGLINE : undefined]}
		>
			<div
				style={{
					fontSize: size,
					fontWeight: 620,
					letterSpacing: "-0.035em",
					lineHeight: 1.02,
				}}
			>
				{title}
			</div>
			{description && (
				<div
					style={{
						marginTop: 26,
						maxWidth: 1000,
						fontSize: 32,
						lineHeight: 1.38,
						color: MUTED,
					}}
				>
					{description}
				</div>
			)}
		</Frame>
	);
}

/**
 * The home page's image: its title, as the page sets it, over
 * `Effect<A, E, R>` with what each parameter keeps typed.
 */
export function HomeImage() {
	const type = { ...MONO, fontSize: 40, color: NOTE } as const;
	return (
		<Frame foot={[HOST, TAGLINE]}>
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					fontSize: 112,
					fontWeight: 620,
					letterSpacing: "-0.035em",
					lineHeight: 0.96,
				}}
			>
				{HEADLINE.map((line, i) => (
					<span key={line} style={i > 0 ? { color: MUTED } : undefined}>
						{line}
					</span>
				))}
			</div>
			<div
				style={{ display: "flex", alignItems: "flex-end", marginTop: 44 }}
			>
				<span style={type}>Effect&lt;</span>
				{CHANNELS.map((channel, i) => (
					<div
						key={channel.id}
						style={{ display: "flex", alignItems: "flex-end" }}
					>
						<span
							style={{
								...MONO,
								fontSize: 40,
								fontWeight: 600,
								color: i === 0 ? LIME : PAPER,
							}}
						>
							{channel.letter}
						</span>
						<span
							style={{
								marginLeft: 12,
								marginBottom: 5,
								fontSize: 26,
								color: MUTED,
							}}
						>
							{i < CHANNELS.length - 1
								? `${channel.short},`
								: channel.short}
						</span>
						{i < CHANNELS.length - 1 ? (
							<span style={{ width: 28 }} />
						) : (
							<span style={type}>&gt;</span>
						)}
					</div>
				))}
			</div>
		</Frame>
	);
}

/** The home-screen icon: the mark on ink, as the favicon draws it. */
export function TouchIcon() {
	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				width: "100%",
				height: "100%",
				backgroundColor: INK,
			}}
		>
			<Mark height={116} padded />
		</div>
	);
}

/**
 * Draws an image as a PNG response, or, for the prerender, as base64 text
 * (see {@link IMAGE_AS_BASE64}). Link previews by default.
 */
export async function imageResponse(
	element: ReactNode,
	request: Request,
	size: { width: number; height: number } = OG_SIZE,
): Promise<Response> {
	const image = await render(element, {
		...size,
		format: "png",
		fonts: FONTS,
		// Drawn from the fonts, so a build never fetches emoji images.
		emoji: "from-font",
	});
	if (request.headers.has(IMAGE_AS_BASE64)) {
		let binary = "";
		for (const byte of image) binary += String.fromCharCode(byte);
		return new Response(btoa(binary), {
			headers: { "Content-Type": "text/plain; charset=utf-8" },
		});
	}
	return new Response(image, {
		headers: { "Content-Type": "image/png" },
	});
}
