import { router } from "@/lib/api/routes";

// Single entry point for the versioned REST API. Routing, validation, auth,
// rate limiting and idempotency live in src/lib/api; endpoints are declared in
// src/lib/api/routes/* (which also generate /api/v1/openapi.json).
export const dynamic = "force-dynamic";

async function handle(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  return router.handle(req, `/${path.map(encodeURIComponent).join("/")}`);
}

export { handle as GET, handle as POST, handle as PATCH, handle as PUT, handle as DELETE };
