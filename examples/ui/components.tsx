// The examples' shared UI. It renders what it's given and reports what the
// user does, so each app's own code is only its data and routing.
import * as React from "react";

export function AppShell({
	nav,
	user,
	children,
}: {
	readonly nav?: React.ReactNode;
	readonly user?: React.ReactNode;
	readonly children: React.ReactNode;
}) {
	return (
		<div className="shell">
			<header className="topbar">
				<div className="brand">
					<span className="brand-mark" aria-hidden>
						✓
					</span>
					Todos
				</div>
				<nav className="nav">{nav}</nav>
				{user}
			</header>
			<main className="page">{children}</main>
			<footer className="footer">
				Data from dummyjson.com, which doesn't save changes: a reload shows
				the server's todos again.
			</footer>
		</div>
	);
}

export function PageHeader({
	title,
	description,
	actions,
}: {
	readonly title: React.ReactNode;
	readonly description?: React.ReactNode;
	readonly actions?: React.ReactNode;
}) {
	return (
		<div className="page-header">
			<div>
				<h1>{title}</h1>
				{description === undefined ? null : <p>{description}</p>}
			</div>
			{actions}
		</div>
	);
}

export function Card({ children }: { readonly children: React.ReactNode }) {
	return <section className="card">{children}</section>;
}

export function UserChip({
	name,
	image,
	onSignOut,
}: {
	readonly name: string;
	readonly image: string;
	readonly onSignOut: () => void;
}) {
	return (
		<div className="user-chip">
			<img src={image} alt="" />
			<span>{name}</span>
			<button type="button" className="button" onClick={onSignOut}>
				Sign out
			</button>
		</div>
	);
}

export interface Credentials {
	readonly username: string;
	readonly password: string;
}

export function LoginCard({
	pending,
	error,
	onSubmit,
}: {
	readonly pending: boolean;
	readonly error?: string | undefined;
	readonly onSubmit: (credentials: Credentials) => void;
}) {
	return (
		<form
			className="card login"
			onSubmit={(event) => {
				event.preventDefault();
				const form = new FormData(event.currentTarget);
				onSubmit({
					username: String(form.get("username")),
					password: String(form.get("password")),
				});
			}}
		>
			<div>
				<h1>Sign in</h1>
				<p>to see your todos.</p>
			</div>
			<label className="field">
				Username
				<input
					name="username"
					defaultValue="emilys"
					autoComplete="username"
				/>
			</label>
			<label className="field">
				Password
				<input
					name="password"
					type="password"
					defaultValue="emilyspass"
					autoComplete="current-password"
				/>
			</label>
			{error === undefined ? null : (
				<p className="form-error" role="alert">
					{error}
				</p>
			)}
			<button type="submit" className="button primary" disabled={pending}>
				{pending ? "Signing in…" : "Sign in"}
			</button>
			<p className="hint">
				A dummyjson user: <code>emilys</code> / <code>emilyspass</code>
			</p>
		</form>
	);
}

export function TodoList({ children }: { readonly children: React.ReactNode }) {
	return <ul className="todo-list">{children}</ul>;
}

export function TodoRow({
	title,
	done,
	pending = false,
	error,
	onToggle,
	onDelete,
}: {
	readonly title: React.ReactNode;
	readonly done: boolean;
	readonly pending?: boolean | undefined;
	readonly error?: string | undefined;
	readonly onToggle: (done: boolean) => void;
	readonly onDelete?: (() => void) | undefined;
}) {
	const titleId = React.useId();
	const className = ["todo-row", done ? "done" : "", pending ? "pending" : ""]
		.filter(Boolean)
		.join(" ");
	return (
		<li className={className}>
			<input
				type="checkbox"
				aria-labelledby={titleId}
				checked={done}
				disabled={pending}
				onChange={(event) => onToggle(event.target.checked)}
			/>
			<span id={titleId} className="todo-title">
				{title}
			</span>
			{error === undefined ? null : (
				<span className="row-error" role="alert">
					{error}
				</span>
			)}
			{onDelete === undefined ? null : (
				<button
					type="button"
					className="button ghost"
					disabled={pending}
					onClick={onDelete}
				>
					Delete
				</button>
			)}
		</li>
	);
}

export function StatusBadge({ done }: { readonly done: boolean }) {
	return (
		<span className={done ? "badge done" : "badge"}>
			{done ? "Done" : "Open"}
		</span>
	);
}

export function LoadMore({
	loading,
	onClick,
}: {
	readonly loading: boolean;
	readonly onClick: () => void;
}) {
	return (
		<div className="list-footer">
			<button
				type="button"
				className="button"
				disabled={loading}
				onClick={onClick}
			>
				{loading ? "Loading…" : "Load more"}
			</button>
		</div>
	);
}

export function RefreshButton({
	refreshing,
	onClick,
}: {
	readonly refreshing: boolean;
	readonly onClick: () => void;
}) {
	return (
		<button
			type="button"
			className="button"
			disabled={refreshing}
			onClick={onClick}
		>
			{refreshing ? "Refreshing…" : "Refresh"}
		</button>
	);
}

export function Skeleton({ rows = 3 }: { readonly rows?: number | undefined }) {
	return (
		<div className="card skeleton" aria-busy="true" aria-label="Loading">
			{Array.from({ length: rows }, (_, row) => (
				<div key={row} className="skeleton-row" />
			))}
		</div>
	);
}

export function EmptyState({
	children,
}: {
	readonly children: React.ReactNode;
}) {
	return <p className="empty">{children}</p>;
}

export function ErrorPanel({
	title,
	message,
	onRetry,
}: {
	readonly title: string;
	readonly message: string;
	readonly onRetry?: (() => void) | undefined;
}) {
	return (
		<div className="card error-panel" role="alert">
			<h2>{title}</h2>
			<p>{message}</p>
			{onRetry === undefined ? null : (
				<button type="button" className="button" onClick={onRetry}>
					Try again
				</button>
			)}
		</div>
	);
}

export function NotFoundPanel() {
	return (
		<ErrorPanel
			title="Page not found"
			message="There's nothing at this address."
		/>
	);
}
