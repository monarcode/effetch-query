import { createContext } from "react-router";

import type { User } from "./dummyjson.js";

/**
 * The signed-in user, which the signed-in layout's middleware sets before
 * any page below it loads.
 */
export const userContext = createContext<User>();
