/**
 * Auto-generated 1200x630 Open Graph card for synod.gudman.xyz.
 * Next.js convention: this file's default export is rendered at /opengraph-image.
 * Used by Twitter/X, LinkedIn, Telegram, Discord previews.
 */

import { ImageResponse } from "next/og";

export const runtime = "edge";

export const alt = "Synod — AI Receipts";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OG() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px",
          background:
            "radial-gradient(ellipse at 30% 30%, rgba(0,229,160,0.18) 0%, rgba(0,229,160,0.02) 40%, transparent 70%), #0b0f15",
          fontFamily: "system-ui, sans-serif",
          color: "#e8edf3",
        }}
      >
        {/* eyebrow */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "16px",
            color: "#00e5a0",
            fontSize: "22px",
            fontWeight: 500,
            textTransform: "uppercase",
            letterSpacing: "0.18em",
          }}
        >
          <div
            style={{
              width: "12px",
              height: "12px",
              borderRadius: "999px",
              background: "#00e5a0",
              boxShadow: "0 0 24px rgba(0,229,160,0.8)",
            }}
          />
          synod · live
        </div>

        {/* main mark */}
        <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
          <div
            style={{
              fontSize: "144px",
              fontWeight: 700,
              letterSpacing: "-0.04em",
              lineHeight: 0.95,
              color: "#fafbfc",
            }}
          >
            AI Receipts.
          </div>
          <div
            style={{
              fontSize: "36px",
              fontWeight: 400,
              color: "#9ba9bc",
              maxWidth: "1000px",
              lineHeight: 1.2,
            }}
          >
            Verifiable, transferable, ENS-addressable, 0G-anchored proofs of multi-model AI consensus.
          </div>
        </div>

        {/* footer chips */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "20px",
            fontSize: "22px",
            color: "#6b7a8e",
          }}
        >
          <span style={{ display: "flex", color: "#cdd6e0" }}>synodai.eth</span>
          <span>·</span>
          <span style={{ display: "flex" }}>Gensyn AXL</span>
          <span>·</span>
          <span style={{ display: "flex" }}>0G Storage</span>
          <span style={{ marginLeft: "auto", color: "#9ba9bc" }}>synod.gudman.xyz</span>
        </div>
      </div>
    ),
    { ...size }
  );
}
