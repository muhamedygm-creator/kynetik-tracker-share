import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PDF exports: pdfkit loads its built-in fonts by name at run time ("#standard-fonts/Helvetica"), which file
  // tracing can't see, so Vercel left them out and every PDF failed (HTTP 500). Ship them with the export routes.
  outputFileTracingIncludes: {
    "/api/export/**": ["./node_modules/pdfkit/js/standard-fonts/**", "./node_modules/pdfkit/js/data/**"],
  },
};

export default nextConfig;
