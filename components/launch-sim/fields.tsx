// Advanced-settings field inputs extracted from LaunchSimulation.tsx.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { parseNumericText } from "./format";

function AdvancedGroup({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div>
        <h3 className="text-[11px] font-semibold text-neutral-800">{title}</h3>
        <p className="mt-0.5 text-[10px] leading-snug text-neutral-500">
          {description}
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {children}
      </div>
    </section>
  );
}

function NumField({
  label,
  unit,
  help,
  value,
  onChange,
  step,
  small,
}: {
  label: string;
  unit?: string;
  help?: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  small?: boolean;
}) {
  // Local text buffer so the field can be emptied while typing — the parent
  // still holds a number. Without this, backspacing to "" snaps back to 0 and
  // the 0 acts like un-deletable text instead of a placeholder.
  const [text, setText] = useState(
    Number.isFinite(value) ? String(value) : ""
  );
  const editing = useRef(false);

  // Reflect external value changes (recompute, reset, scenario load) only when
  // the user isn't actively editing this field.
  useEffect(() => {
    if (!editing.current) setText(Number.isFinite(value) ? String(value) : "");
  }, [value]);

  return (
    <div>
      <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-neutral-500">
        {label}
      </label>
      <div className="relative">
        <input
          type="text"
          inputMode="decimal"
          value={text}
          placeholder="0"
          step={step}
          autoComplete="off"
          onFocus={() => {
            editing.current = true;
          }}
          onBlur={(e) => {
            editing.current = false;
            const n = parseNumericText(e.currentTarget.value);
            onChange(n);
            // Normalise the display; clamped/rounded parent values will flow in
            // immediately through the effect above.
            setText(Number.isFinite(n) ? String(n) : "");
          }}
          onChange={(e) => {
            const raw = e.target.value;
            setText(raw);
            // Empty / partial ("-", ".") report 0 to the parent but keep the raw
            // text so the user can keep typing. Commas/currency symbols pasted
            // from spreadsheets or dashboards are accepted and normalised later.
            onChange(parseNumericText(raw));
          }}
          className={`w-full rounded-lg border border-neutral-300 px-2.5 outline-none focus:border-indigo-500 ${
            unit ? "pr-24" : ""
          } ${small ? "py-1 text-xs" : "py-1.5 text-sm"}`}
        />
        {unit && (
          <span className="pointer-events-none absolute inset-y-0 right-2 flex max-w-20 items-center truncate text-[10px] font-medium text-neutral-400">
            {unit}
          </span>
        )}
      </div>
      {help && (
        <p className="mt-1 text-[10px] leading-snug text-neutral-400">
          {help}
        </p>
      )}
    </div>
  );
}

function NullableNumField({
  label,
  unit,
  help,
  value,
  onChange,
  step,
  small,
}: {
  label: string;
  unit?: string;
  help?: string;
  value: number | null;
  onChange: (v: number | null) => void;
  step?: number;
  small?: boolean;
}) {
  const [text, setText] = useState(
    value != null && Number.isFinite(value) ? String(value) : ""
  );
  const editing = useRef(false);

  useEffect(() => {
    if (!editing.current) {
      setText(value != null && Number.isFinite(value) ? String(value) : "");
    }
  }, [value]);

  const commit = (raw: string) => {
    if (raw.trim() === "") {
      onChange(null);
      setText("");
      return;
    }
    const n = parseNumericText(raw);
    onChange(n);
    setText(Number.isFinite(n) ? String(n) : "");
  };

  return (
    <div>
      <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-neutral-500">
        {label}
      </label>
      <div className="relative">
        <input
          type="text"
          inputMode="decimal"
          value={text}
          placeholder="Auto"
          step={step}
          autoComplete="off"
          onFocus={() => {
            editing.current = true;
          }}
          onBlur={(e) => {
            editing.current = false;
            commit(e.currentTarget.value);
          }}
          onChange={(e) => {
            const raw = e.target.value;
            setText(raw);
            onChange(raw.trim() === "" ? null : parseNumericText(raw));
          }}
          className={`w-full rounded-lg border border-neutral-300 px-2.5 outline-none focus:border-indigo-500 ${
            unit ? "pr-24" : ""
          } ${small ? "py-1 text-xs" : "py-1.5 text-sm"}`}
        />
        {unit && (
          <span className="pointer-events-none absolute inset-y-0 right-2 flex max-w-20 items-center truncate text-[10px] font-medium text-neutral-400">
            {unit}
          </span>
        )}
      </div>
      {help && (
        <p className="mt-1 text-[10px] leading-snug text-neutral-400">
          {help}
        </p>
      )}
    </div>
  );
}

// --- helpers ---------------------------------------------------------------


export { AdvancedGroup, NumField, NullableNumField };
