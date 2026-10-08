import "server-only";
import { Router, type RouteDef } from "@/lib/api/router";
import { coreRoutes } from "./core";
import { facilityRoutes } from "./facility";
import { expenseRoutes } from "./expense";
import { taskRoutes } from "./tasks";
import { poRoutes } from "./po";
import { publicRoutes } from "./public";
import { platformRoutes } from "./platform";
import { surveyRoutes } from "./surveys";
import { buildOpenApi } from "@/lib/api/openapi";
import { publicRoute } from "@/lib/api/router";

const docsRoutes: RouteDef[] = [
  publicRoute({
    public: true,
    method: "GET",
    path: "/openapi.json",
    summary: "OpenAPI 3.1 specification",
    tags: ["meta"],
    rateLimit: { name: "openapi", limit: 60 },
    handler: async ({ req }) => Response.json(buildOpenApi(allRoutes, new URL(req.url).origin)),
  }),
  publicRoute({
    public: true,
    method: "GET",
    path: "/health",
    summary: "Health check",
    tags: ["meta"],
    rateLimit: { name: "health", limit: 120 },
    handler: async () => ({ ok: true, time: new Date().toISOString() }),
  }),
];

export const allRoutes: RouteDef[] = [
  ...docsRoutes,
  ...publicRoutes,
  ...platformRoutes,
  ...coreRoutes,
  ...facilityRoutes,
  ...expenseRoutes,
  ...taskRoutes,
  ...poRoutes,
  ...surveyRoutes,
];

export const router = new Router(allRoutes);
