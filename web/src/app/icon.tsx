import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(<div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(145deg,#075348,#16966E 58%,#56D39B)", color: "white", fontSize: 300, fontWeight: 900, borderRadius: 112 }}>F</div>, size);
}
