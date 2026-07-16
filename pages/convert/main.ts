import { convertModHeader } from "../../src/lib/modheader";
import { encodeShare } from "../../src/lib/share";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const input = $<HTMLTextAreaElement>("input");
const output = $<HTMLTextAreaElement>("output");
const errorEl = $<HTMLParagraphElement>("error");
const resultEl = $<HTMLElement>("result");
const summaryEl = $<HTMLParagraphElement>("summary");
const warningsEl = $<HTMLUListElement>("warnings");
const copiedEl = $<HTMLSpanElement>("copied");

function showError(message: string) {
  errorEl.textContent = message;
  errorEl.hidden = false;
  resultEl.hidden = true;
}

function convert() {
  errorEl.hidden = true;
  copiedEl.hidden = true;

  let parsed: unknown;
  try {
    parsed = JSON.parse(input.value);
  } catch (e) {
    showError(`Not valid JSON: ${(e as Error).message}`);
    return;
  }

  let result;
  try {
    result = convertModHeader(parsed);
  } catch (e) {
    showError((e as Error).message);
    return;
  }

  const { config, warnings } = result;
  output.value = encodeShare({ kind: "g", config });

  const profileCount = config.profiles.length;
  const ruleCount = config.profiles.reduce((n, p) => n + p.rules.length, 0);
  summaryEl.textContent =
    `Converted ${profileCount} profile${profileCount === 1 ? "" : "s"} ` +
    `(${ruleCount} header rule${ruleCount === 1 ? "" : "s"}). ` +
    `All profiles are imported disabled — review scope, then enable them in the extension.`;

  warningsEl.replaceChildren(
    ...warnings.map((w) => {
      const li = document.createElement("li");
      li.textContent = `⚠ ${w}`;
      return li;
    }),
  );

  resultEl.hidden = false;
}

$<HTMLButtonElement>("convert").addEventListener("click", convert);
$<HTMLButtonElement>("copy").addEventListener("click", async () => {
  await navigator.clipboard.writeText(output.value);
  copiedEl.hidden = false;
});
