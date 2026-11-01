import {
	index,
	layout,
	route,
	type RouteConfig,
} from "@react-router/dev/routes";

export default [
	route("login", "routes/login.tsx"),
	layout("routes/signed-in.tsx", [
		index("routes/my-todos.tsx"),
		route("todos", "routes/all-todos.tsx"),
		route("todos/:id", "routes/todo.tsx"),
	]),
] satisfies RouteConfig;
