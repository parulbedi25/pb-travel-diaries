import { useEffect, useMemo, useState } from "react";
import { ExternalLink, X } from "lucide-react";
import {
  useSite,
  type SectionEntry,
  type SectionType,
} from "../store/siteContent";
import { getAt } from "../utils/objectPath";

type FieldLike = {
  path: string;
  label: string;
  kind: string;
  hint?: string;
};

type EditorModule = {
  SECTION_FIELDS: Record<SectionType, FieldLike[]> | Record<string, FieldLike[]>;
  CUSTOM_FIELDS: FieldLike[];
  FieldRow: React.ComponentType<{
    field: unknown;
    value: unknown;
    onChange: (v: unknown) => void;
  }>;
  ItemsField: React.ComponentType<{
    field: unknown;
    value: unknown[];
    onChange: (v: unknown) => void;
    onItemToggle?: (index: number, enabled: boolean) => void;
  }>;
  RevealPicker: React.ComponentType<{
    value: unknown;
    sections: { id: string; label: string; type: string; enabled: boolean }[];
    onChange: (ids: string[]) => void;
  }>;
  HotspotEditor: React.ComponentType<{
    spots: unknown[];
    mainImage: string;
    onChange: (v: unknown) => void;
    onItemToggle: (index: number, enabled: boolean) => void;
  }>;
};

/**
 * On-site editor for one section. Loads the dashboard's own field schema and
 * renderer so every section edits identically whether it is edited here or in
 * the dashboard; the module is loaded only when the editor is opened.
 */
export default function InlineSectionEditor({
  entry,
  onClose,
}: {
  entry: SectionEntry;
  onClose: () => void;
}) {
  const { draft, updateSectionField, toggleSectionChild } = useSite();
  const [editor, setEditor] = useState<EditorModule | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    import("./AdminPage")
      .then((mod) => {
        if (!cancelled) setEditor(mod as unknown as EditorModule);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The draft is the editing surface here, so pending changes are visible
  // exactly as they are in the dashboard.
  const current = draft.sections.find((s) => s.id === entry.id) ?? entry;
  const fields = useMemo(() => {
    if (!editor) return [];
    return current.type === "custom"
      ? (editor.CUSTOM_FIELDS ?? [])
      : ((editor.SECTION_FIELDS as Record<string, FieldLike[]>)[current.type] ?? []);
  }, [editor, current.type]);

  return (
    <aside
      role="dialog"
      aria-modal="true"
      aria-label={`Edit ${current.label}`}
      className="fixed inset-y-0 right-0 z-[80] flex w-full max-w-xl flex-col border-l border-white/10 bg-ink-950 shadow-2xl shadow-black/50"
    >
      <div className="flex items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
        <div className="min-w-0">
          <h2 className="truncate font-display text-base font-semibold text-white">
            {current.label}
          </h2>
          <p className="text-[11px] text-zinc-500">
            Edit this section live — changes are saved to your draft, then publish with Save Changes.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close editor"
          className="aspect-square grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/[0.06] text-zinc-400 hover:bg-white/[0.15] hover:text-white"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {!editor && !failed && (
          <p className="py-12 text-center text-sm text-zinc-500">Loading editor…</p>
        )}
        {failed && (
          <p className="rounded-2xl border border-red-400/25 bg-red-400/10 p-5 text-sm text-red-300">
            The editor could not load. Open the dashboard to edit this section.
          </p>
        )}
        {editor && (
          <>
            <div className="grid gap-5">
              {fields.map((field) => {
                if (field.kind === "reveal") {
                  return (
                    <editor.RevealPicker
                      key={field.path}
                      value={getAt(current.data, field.path)}
                      sections={draft.sections}
                      onChange={(ids: string[]) =>
                        updateSectionField(current.id, current.label, field.path, ids)
                      }
                    />
                  );
                }
                if (field.kind === "items") {
                  return (
                    <editor.ItemsField
                      key={field.path}
                      field={field}
                      value={(getAt(current.data, field.path) as unknown[]) ?? []}
                      onChange={(v) => updateSectionField(current.id, current.label, field.path, v)}
                      onItemToggle={(index, enabled) =>
                        toggleSectionChild(current.id, current.label, field.path, index, enabled)
                      }
                    />
                  );
                }
                if (field.path === "hotspots") {
                  return (
                    <editor.HotspotEditor
                      key={field.path}
                      spots={((getAt(current.data, "hotspots") as unknown[]) ?? [])}
                      mainImage={String(getAt(current.data, "mainImage") ?? "")}
                      onChange={(v) => updateSectionField(current.id, current.label, "hotspots", v)}
                      onItemToggle={(index, enabled) =>
                        toggleSectionChild(current.id, current.label, "hotspots", index, enabled)
                      }
                    />
                  );
                }
                return (
                  <editor.FieldRow
                    key={field.path}
                    field={field}
                    value={getAt(current.data, field.path)}
                    onChange={(v) => updateSectionField(current.id, current.label, field.path, v)}
                  />
                );
              })}
            </div>
          </>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-white/10 px-5 py-4">
        <a
          href="#/admin"
          onClick={onClose}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-400 hover:text-white"
        >
          Open full dashboard <ExternalLink className="h-3 w-3" />
        </a>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-ink-950"
        >
          Done
        </button>
      </div>
    </aside>
  );
}
