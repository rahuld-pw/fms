import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Campus Ops",
    short_name: "Campus Ops",
    description: "Facility, expense, task and purchase management for schools",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#1f9d55",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
