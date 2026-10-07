import { Redoc } from "./redoc";

export const metadata = { title: "API reference" };

/** Public API reference rendered from /api/v1/openapi.json. */
export default function ApiDocsPage() {
  return <Redoc />;
}
