import { Resvg } from "@resvg/resvg-js";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const svg = readFileSync("assets/icon.svg", "utf8");
mkdirSync("public/icons", { recursive: true });
for (const size of [16, 48, 128]) {
  const png = new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng();
  writeFileSync(`public/icons/${size}.png`, png);
}
console.log("icons written");
