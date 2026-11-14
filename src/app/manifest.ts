import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "marknotes",
    short_name: "marknotes",
    description: "Your markdown notes.",
    start_url: "/",
    display: "standalone",
    background_color: "#f5f3ee",
    theme_color: "#2c4f8c",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
