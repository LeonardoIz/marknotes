"use client";

import { Download } from "lucide-react";
import { useId, useRef, useState } from "react";
import type { AccessSummary } from "@/lib/access";
import type { McpToken, Settings } from "@/lib/db";
import type { Grant } from "@/lib/oauth";
import type { SemanticStatus } from "@/lib/semantic";
import { formatTime, localTime } from "@/lib/templates";
import { AccessSettings } from "./AccessSettings";
import { AgentTokens } from "./AgentTokens";
import { ThemeSwitch } from "./theme";
import { buttonClass, Segmented, Switch, toast } from "./ui";

/* ---------- Controls, using the app’s theme ---------- */

function NumberField({ value, min, max, onChange, label, unit }: { value: number; min: number; max: number; onChange: (v: number) => void; label: string; unit?: string }) {
  const [draft, setDraft] = useState(String(value));
  const commit = () => {
    const n = Math.round(Number(draft));
    if (!Number.isFinite(n) || n < min || n > max) return setDraft(String(value));
    if (n !== value) onChange(n);
  };
  return (
    <span className="flex items-center gap-2">
      <input
        type="number"
        inputMode="numeric"
        aria-label={label}
        min={min}
        max={max}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        className="h-8 w-16 rounded-lg border bg-field px-2.5 text-right font-mono text-[13px] transition-colors outline-none [appearance:textfield] hover:border-ring/60 focus-visible:border-ring [&::-webkit-inner-spin-button]:appearance-none"
      />
      {unit && <span className="font-mono text-[11px] text-faint">{unit}</span>}
    </span>
  );
}

/** A text setting, saved when you leave the field or press Enter. `options` adds suggestions. */
function TextField({ value, onChange, label, placeholder, options = [], mono }: { value: string; onChange: (v: string) => void; label: string; placeholder?: string; options?: string[]; mono?: boolean }) {
  const [draft, setDraft] = useState(value);
  const id = useId();
  const commit = () => {
    const next = draft.trim();
    if (next !== value) onChange(next);
    setDraft(next);
  };
  return (
    <>
      <input
        aria-label={label}
        value={draft}
        list={options.length ? id : undefined}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        className={`h-8 w-44 rounded-lg border bg-field px-2.5 text-[13px] transition-colors outline-none placeholder:text-faint hover:border-ring/60 focus-visible:border-ring max-sm:w-36 ${mono ? "font-mono" : ""}`}
      />
      {options.length > 0 && (
        <datalist id={id}>
          {options.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
      )}
    </>
  );
}

function Row({ title, description, children }: { title: string; description?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 border-b border-rule py-4">
      <div className="min-w-0">
        <div className="text-[14px]">{title}</div>
        {description && <div className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">{description}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="kicker border-b pb-2.5">{title}</h2>
      {children}
    </section>
  );
}

/* ---------- The form: every change is saved at once ---------- */

function semanticText(status: SemanticStatus) {
  switch (status.state) {
    case "ready":
      return `Ready: ${status.notes} ${status.notes === 1 ? "note" : "notes"} indexed. A small model on this server reads them; nothing leaves it.`;
    case "indexing":
      return `Indexing: ${status.done} of ${status.total} notes read.`;
    case "loading":
      return "Loading the model…";
    case "error":
      return `Could not start: ${status.message}`;
    default:
      return "Find notes about the same thing in other words. Prepared on the first search by meaning (downloads a ~120 MB model, which runs here).";
  }
}

export function SettingsForm({
  initial,
  folders,
  templates,
  semantic,
  access,
  accessError,
  mcp,
}: {
  initial: Settings;
  folders: string[];
  templates: string[];
  semantic: SemanticStatus;
  access: AccessSummary;
  accessError: string;
  mcp: { tokens: McpToken[]; grants: Grant[] };
}) {
  const [settings, setSettings] = useState(initial);
  const saved = useRef(initial);

  const set = async <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((s) => ({ ...s, [key]: value }));
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [key]: value }),
    }).catch(() => null);
    const data = await res?.json().catch(() => null);
    if (!res?.ok) {
      setSettings(saved.current);
      return toast(data?.error ?? "Could not save the setting.", "error");
    }
    saved.current = data.settings;
    toast("Saved");
  };

  const toggle = (key: keyof Settings, title: string, description?: string) => (
    <Row title={title} description={description}>
      <Switch label={title} checked={settings[key] as boolean} onChange={(v) => set(key, v as never)} />
    </Row>
  );

  return (
    <div className="animate-in duration-300 fade-in">
      <Section title="Sign-in">
        <AccessSettings access={access} error={accessError} />
      </Section>

      <Section title="Home">
        <Row title="Recently modified" description="How many notes the home page lists. 0 hides the list.">
          <NumberField label="Recently modified" min={0} max={50} value={settings.homeRecentCount} onChange={(v) => set("homeRecentCount", v)} unit="notes" />
        </Row>
        {toggle("homeShowPinned", "Pinned notes", "Show pinned notes above the recent ones.")}
        {toggle("homeShowViews", "Saved views", "Show your saved searches on the home page.")}
      </Section>

      <Section title="Editor">
        <Row title="Font" description="Sans keeps headings in the serif; mono is a plain text editor.">
          <Segmented label="Editor font" value={settings.editorFont} options={[["sans", "Sans"], ["mono", "Mono"]]} onChange={(v) => set("editorFont", v)} />
        </Row>
        {toggle("editorSpellcheck", "Spellcheck", "Underline misspelled words while writing.")}
      </Section>

      <Section title="Templates and daily notes">
        <Row
          title="Templates folder"
          description={
            <>
              Its notes are offered when you start a new one. They can use <code className="font-mono text-[11.5px]">{"{{title}}"}</code>,{" "}
              <code className="font-mono text-[11.5px]">{"{{date}}"}</code>, <code className="font-mono text-[11.5px]">{"{{time}}"}</code> and{" "}
              <code className="font-mono text-[11.5px]">{"{{date:DD/MM/YYYY}}"}</code>.
            </>
          }
        >
          <TextField label="Templates folder" value={settings.templatesFolder} placeholder="None" options={folders} onChange={(v) => set("templatesFolder", v)} />
        </Row>
        <Row title="Daily notes folder" description="Where today's note goes (Ctrl+Alt+D, or Today in the menu). Empty puts it at the top level.">
          <TextField label="Daily notes folder" value={settings.dailyFolder} placeholder="Top level" options={folders} onChange={(v) => set("dailyFolder", v)} />
        </Row>
        <Row
          title="Daily note title"
          description={
            <>
              YYYY MM DD (and HH mm), [text] for words. Today: <span className="text-foreground">{formatTime(settings.dailyFormat, localTime())}</span>
            </>
          }
        >
          <TextField label="Daily note title" mono value={settings.dailyFormat} onChange={(v) => v && set("dailyFormat", v)} />
        </Row>
        <Row title="Daily template" description={templates.length ? "The template a new daily note starts from." : "Add notes to the templates folder to choose one."}>
          <TextField label="Daily template" value={settings.dailyTemplate} placeholder="None" options={templates} onChange={(v) => set("dailyTemplate", v)} />
        </Row>
      </Section>

      <Section title="Search">
        <Row title="Search by meaning" description={settings.semanticSearch ? semanticText(semantic) : "Off. Search by words and #tags still works."}>
          <Switch label="Search by meaning" checked={settings.semanticSearch} onChange={(v) => set("semanticSearch", v)} />
        </Row>
      </Section>

      <Section title="Reading">
        {toggle("readingShowToc", "Table of contents", "The “On this page” outline beside long notes, on wide screens.")}
        {toggle("readingShowBacklinks", "Linked from", "List the notes that link to the one you are reading.")}
        {toggle("readingInteractiveTasks", "Tick tasks while reading", "Click a task's box to check it off without opening the editor.")}
      </Section>

      <Section title="Trash">
        <Row title="Keep deleted notes" description="Older ones are erased for good. 0 keeps them forever.">
          <NumberField label="Keep deleted notes" min={0} max={3650} value={settings.trashRetentionDays} onChange={(v) => set("trashRetentionDays", v)} unit="days" />
        </Row>
      </Section>

      <Section title="Export">
        <Row title="Download everything" description="Every note in its folders, and the attachments, as a .zip of plain Markdown files.">
          <a href="/api/export" download className={buttonClass("outline", "sm")}>
            <Download aria-hidden /> .zip
          </a>
        </Row>
      </Section>

      <Section title="Agents (MCP)">
        {toggle("mcpEnabled", "Let agents connect", "Claude Code and other MCP clients can use your notes. They sign in the way you do, or with a token from below.")}
        {settings.mcpEnabled && (
          <>
            <AgentTokens initial={mcp.tokens} grants={mcp.grants} open={access.mode === "none"} />
            <Row title="Read only for all agents" description="Agents can search and read, but not create, edit or delete. Each agent can also be read only on its own.">
              <Switch label="Read only" checked={settings.mcpReadOnly} onChange={(v) => set("mcpReadOnly", v)} />
            </Row>
          </>
        )}
      </Section>

      <Section title="Appearance">
        <Row title="Theme" description="Saved in this browser, so each device can have its own.">
          <ThemeSwitch />
        </Row>
      </Section>
    </div>
  );
}
