import { createFileRoute } from "@tanstack/react-router";
import { Studio } from "@/components/studio/Studio";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "AK-47 Skin Studio — fit, preview, export .mdl" },
      { name: "description", content: "Upload an AK-47 skin sheet, fit it to the fixed layout, preview it in 3D and download a ready .mdl." },
      { property: "og:title", content: "AK-47 Skin Studio" },
      { property: "og:description", content: "Fit a skin sheet, preview it in 3D and export a ready .mdl." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Studio,
});
