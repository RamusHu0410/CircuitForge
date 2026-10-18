import type { Check, Project, Step } from "../types";
import type { GenerateResponse } from "./backend";

const KIND_NAMES: Record<string, string> = { led: "LED", npn: "NPN transistor", ldo: "LDO regulator" };

/** "connector_2pin" → "Connector 2pin", with a few common acronyms kept. */
function kindName(kind: string): string {
  if (KIND_NAMES[kind]) return KIND_NAMES[kind];
  const words = kind.split("_").join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Turn an engine result into the transcript's steps and the checks list. Nothing is invented. */
export function toProject(res: GenerateResponse): Project {
  const { circuit, validation, erc } = res;
  const comps = circuit.components;
  // A dev board leaves many pins unused on purpose; that's expected, not a warning per pin.
  const unused = validation.warnings.filter((w) => w.code === "PIN_UNCONNECTED");
  // Which Classroom section explains a step (the lesson comes from the backend, built for this circuit).
  const sections = res.lesson?.sections ?? [];
  const sectionFor = (pred: (s: (typeof sections)[number]) => boolean) => sections.find(pred)?.id;
  const warnings = validation.warnings.filter((w) => w.code !== "PIN_UNCONNECTED");

  const steps: Step[] = [
    {
      id: "parse",
      title: "Read request",
      call: "Parse(request)",
      lines: [circuit.title, ...(circuit.description ? [circuit.description] : []), `interpreter: ${res.generator === "rules" ? "rule-based (no AI)" : "LLM"}`],
      status: "done",
      parts: [],
      sectionId: sectionFor((s) => s.kind === "overview"),
    },
    {
      id: "parts",
      title: `Pick ${comps.length} parts`,
      call: `Place(${comps.length} parts)`,
      lines: comps.map((c) => `${c.ref} ${c.value}${c.purpose ? ` · ${c.purpose}` : ""}`),
      status: "done",
      parts: comps.map((c) => ({ ref: c.ref, name: kindName(c.kind), value: c.value })),
      sectionId: sectionFor((s) => s.kind === "parts"),
    },
    ...circuit.notes.map((note, i): Step => {
      const ref = /^([A-Z]{1,3}\d{1,3})\b/.exec(note)?.[1];
      return {
        id: `note-${i}`,
        title: ref ? `Calculate ${ref}` : "Note",
        call: ref ? `Calculate(${ref})` : "Note()",
        lines: [note],
        status: "done",
        parts: [],
        sectionId: ref ? sectionFor((s) => s.kind === "math" && s.refs.includes(ref)) : undefined,
      };
    }),
    {
      id: "wire",
      title: "Wire nets",
      call: `Wire(${circuit.nets.length} nets)`,
      lines: [
        ...circuit.nets.slice(0, 5).map((n) => `${n.name}: ${n.connections.map((p) => `${p.ref}.${p.pin}`).join("  ")}`),
        ...(circuit.nets.length > 5 ? [`… ${circuit.nets.length - 5} more`] : []),
      ],
      status: "done",
      parts: [],
      sectionId: sectionFor((s) => s.kind === "build"),
    },
    ...(res.firmware
      ? [
          {
            id: "code",
            title: "Write firmware",
            call: `Write(${res.firmware.file_name})`,
            lines: [`${res.firmware.code.split("\n").length} lines of Arduino C++ for the ${res.firmware.board}`, ...res.firmware.summary],
            status: "done",
            parts: [],
            editor: "firmware",
          } satisfies Step,
        ]
      : []),
    {
      id: "validate",
      title: "Validate circuit",
      call: "Validate(circuit)",
      lines: validation.valid
        ? ["every pin and net checks out", ...(unused.length ? [`${unused.length} unused pins marked no-connect`] : []), ...warnings.map((w) => `warning: ${w.message}`)]
        : validation.errors.map((e) => e.message),
      status: !validation.valid ? "failed" : warnings.length ? "warning" : "done",
      parts: [],
      sectionId: sectionFor((s) => s.kind === "check"),
    },
    {
      id: "erc",
      title: "Run KiCad ERC",
      call: "Run(KiCad ERC)",
      lines: [erc.message, ...(erc.ran ? [`${erc.error_count} errors · ${erc.warning_count} warnings`] : [])],
      status: !erc.ran ? "warning" : erc.passed ? "done" : "failed",
      parts: [],
      sectionId: sectionFor((s) => s.kind === "check"),
    },
  ];

  const checks: Check[] = [
    {
      id: "c-valid",
      label: validation.valid ? "circuit valid" : `${validation.errors.length} validation error(s)`,
      status: validation.valid ? "pass" : "fail",
      stepId: "validate",
    },
    ...warnings.map((w, i): Check => ({ id: `c-w${i}`, label: w.message, status: "warn", stepId: "validate" })),
    ...(unused.length ? [{ id: "c-nc", label: `${unused.length} unused pins marked no-connect`, status: "pass", stepId: "validate" } satisfies Check] : []),
    ...(res.firmware ? [{ id: "c-code", label: "C++ firmware ready", status: "pass", stepId: "code" } satisfies Check] : []),
    {
      id: "c-erc",
      label: !erc.ran ? "KiCad ERC not run" : erc.passed ? "KiCad ERC: 0 violations" : `ERC: ${erc.error_count} errors, ${erc.warning_count} warnings`,
      status: !erc.ran ? "warn" : erc.passed ? "pass" : "fail",
      stepId: "erc",
    },
    ...erc.violations.slice(0, 6).map((v, i): Check => ({ id: `c-v${i}`, label: v.description, status: v.severity === "error" ? "fail" : "warn", stepId: "erc" })),
    { id: "c-parts", label: `${comps.length} parts placed`, status: "pass", stepId: "parts" },
    { id: "c-nets", label: `${circuit.nets.length} nets wired`, status: "pass", stepId: "wire" },
  ];

  return { name: circuit.title, request: res.prompt, steps, checks, files: res.files, firmware: res.firmware ?? undefined, lesson: res.lesson ?? undefined, generator: res.generator };
}
