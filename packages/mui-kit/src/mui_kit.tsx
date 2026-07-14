// muiKit — a meridian ComponentKit that paints panels with MUI. One
// implementation of the ComponentKit interface exported by
// @savvifi/meridian-web-react, a peer of htmlKit / shadcnKit: the kit-agnostic
// PanelRenderer / ViewRenderer dispatch the descriptor shapes to these
// components, so the same ViewDescriptor renders here as MUI tables + forms
// (with CLIENT / OFFSET / CURSOR pagination) instead of plain HTML.
//
// The kit owns its components (MeridianTable / MeridianForm, lifted + generalized
// from the aion @aion/ui patterns) — no @aion/ui dependency — so the MUI table +
// form patterns are reusable by any meridian host, not just aion/studio.

import { useContext, useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

import { Alert, Box, Button, Chip, IconButton, Link, Menu, MenuItem, Stack } from "@mui/material";

import type {
  ActionBarProps,
  ComponentKit,
  ShapeProps,
} from "@savvifi/meridian-web-react";
import {
  MeridianRowActionsContext,
  MeridianViewContext,
  PaginationMode,
  useActionHandler,
  useHrefResolver,
  usePagedRows,
} from "@savvifi/meridian-web-react";
import type { FormField } from "@savvifi/meridian-proto-ts/proto/form_pb.js";
import type { GalleryPanel } from "@savvifi/meridian-proto-ts/proto/gallery_pb.js";
import type { LroPanel } from "@savvifi/meridian-proto-ts/proto/lro_pb.js";
import {
  FormMode,
  type DetailHeaderPanel,
  type FormPanel,
  type PanelDescriptor,
  type RecordCardPanel,
} from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import type { PromptPanel } from "@savvifi/meridian-proto-ts/proto/prompt_pb.js";
import type { RpcCall } from "@savvifi/meridian-proto-ts/proto/rpc_pb.js";
import {
  ColumnFormat,
  type TableColumn,
  type TablePanel,
} from "@savvifi/meridian-proto-ts/proto/table_pb.js";
import type { Theme } from "@savvifi/meridian-proto-ts/proto/theme_pb.js";
import { ActionPlacement, type Action } from "@savvifi/meridian-proto-ts/proto/view_pb.js";
import type { ActionPanel } from "@savvifi/meridian-proto-ts/proto/affordance_pb.js";
import type { CatalogPanel } from "@savvifi/meridian-proto-ts/proto/catalog_pb.js";
import type { ChoicePanel } from "@savvifi/meridian-proto-ts/proto/choice_pb.js";
import type { ConnectFlowPanel } from "@savvifi/meridian-proto-ts/proto/connect_flow_pb.js";
import type { CopyValuePanel } from "@savvifi/meridian-proto-ts/proto/copy_value_pb.js";
import type { GrammarPanel } from "@savvifi/meridian-proto-ts/proto/grammar_pb.js";
import type { SnippetPanel } from "@savvifi/meridian-proto-ts/proto/snippet_pb.js";
import type { StatPanel } from "@savvifi/meridian-proto-ts/proto/stat_pb.js";
import type { RpcInvoker } from "@savvifi/meridian-schemas/uiview";

import {
  ActionView,
  CatalogView,
  ChoiceView,
  ConnectFlowView,
  CopyValueView,
  GrammarView,
  SnippetView,
  StatView,
} from "./components/content.js";
import { MeridianForm, type MeridianFormField } from "./components/form.js";
import { MeridianTable, type MeridianColumn, type MeridianRowAction } from "./components/table.js";
import { MeridianDetailHeader } from "./components/detail_header.js";
import { MeridianGallery } from "./components/gallery.js";
import { MeridianRecordCard } from "./components/record_card.js";

type Row = Record<string, unknown>;

// ── shared helpers ──────────────────────────────────────────────────────────

/** Follow a dotted `field_path` (e.g. "subject.claim.text") into a row/response. */
function getNested(source: unknown, path: string): unknown {
  if (!path) return undefined;
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[key];
    return undefined;
  }, source);
}

/** Format a cell value per the column's ColumnFormat. */
function formatCell(value: unknown, format: ColumnFormat): ReactNode {
  if (value === null || value === undefined) return "";
  switch (format) {
    case ColumnFormat.FLOAT_2DP:
      return typeof value === "number" ? value.toFixed(2) : String(value);
    case ColumnFormat.STRING_LIST:
      return Array.isArray(value) ? value.join(", ") : String(value);
    default:
      return typeof value === "object" ? JSON.stringify(value) : String(value);
  }
}

/** Fire an RpcCall through the invoker (fire-and-forget; result handling TBD). */
function invoke(invoker: RpcInvoker, call: RpcCall | undefined, req: Row = {}): void {
  if (call) void invoker.invoke(call.service, call.method, req);
}

// ── Table ───────────────────────────────────────────────────────────────────

/** Page-size options for the table's page-size selector (parity with DataTableView). */
const TABLE_PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

/** A status/enum column renders its value as a colored MUI Chip (like the old table). */
function isStatusColumn(col: TableColumn): boolean {
  return col.format === ColumnFormat.ENUM_NAME || /^(status|state)$/i.test(col.header.trim());
}

/** Map a status string to an MUI Chip color — best-effort by common vocabulary. */
function statusChipColor(value: string): "default" | "success" | "warning" | "error" | "info" {
  const v = value.toLowerCase();
  if (/(active|complete|approv|success|paid|done|resolved|enabled|live|ready)/.test(v)) return "success";
  if (/(pending|draft|open|in.?progress|review|waiting|processing|scheduled)/.test(v)) return "warning";
  if (/(error|fail|reject|cancel|declin|expired|disabled|inactive|blocked)/.test(v)) return "error";
  return "default";
}

/** Stable comparator over cell values (numeric-aware; nulls sort first). */
function compareCellValues(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

function TableShape({ panel, invoker }: { panel: TablePanel; invoker: RpcInvoker }): ReactNode {
  // usePagedRows (meridian-web-react) is the kit-agnostic pagination brain:
  // CLIENT returns all fetched rows (we slice locally); OFFSET / CURSOR fetch one
  // page at a time via the invoker. MeridianTable just displays a page + a pager.
  const paged = usePagedRows(panel, invoker);
  const client = paged.mode === PaginationMode.CLIENT;
  const [clientPage, setClientPage] = useState(0);
  // Host-controlled column sort. CLIENT sorts the full fetched set (parity with the
  // old DataTableView); server modes sort the current page in place.
  const [sort, setSort] = useState<{ columnId?: string; direction: "asc" | "desc" }>({ direction: "asc" });
  useEffect(() => {
    setClientPage(0);
    setSort({ direction: "asc" });
  }, [panel]);

  // A ColumnLink cell renders its value as a host-resolved link (resolveHref);
  // target_kind empty ⇒ the view's own subject. Absent resolver ⇒ plain text.
  const resolveHref = useHrefResolver();
  const { subjectKind } = useContext(MeridianViewContext);
  const onAction = useActionHandler();

  const columns = useMemo<MeridianColumn<Row>[]>(
    () =>
      panel.columns.map((col: TableColumn, index) => {
        const status = isStatusColumn(col);
        return {
          id: col.fieldPath || col.header || String(index),
          header: col.header,
          width: col.prefWidth || undefined,
          sortable: true,
          render: (row: Row) => {
            const raw = getNested(row, col.fieldPath);
            const text = formatCell(raw, col.format);
            // target_kind empty ⇒ the view's own subject (a self/detail link).
            const targetKind = col.link ? col.link.targetKind || subjectKind : undefined;
            if (targetKind && resolveHref && raw != null && raw !== "") {
              const href = resolveHref(targetKind, String(raw));
              if (href) return <Link href={href} underline="hover">{text}</Link>;
            }
            // Status/enum ⇒ a colored chip (matches the old studio status pills).
            if (status && raw != null && raw !== "") {
              const label = String(text);
              return <Chip label={label} size="small" variant="outlined" color={statusChipColor(label)} />;
            }
            return text;
          },
        };
      }),
    [panel.columns, resolveHref, subjectKind],
  );

  // Resolve the sort column's field_path (columns are keyed by field_path||header).
  const sortFieldPath = useMemo(() => {
    if (!sort.columnId) return undefined;
    const col = panel.columns.find((c) => (c.fieldPath || c.header) === sort.columnId);
    return col?.fieldPath || undefined;
  }, [sort.columnId, panel.columns]);
  const sortRows = (input: Row[]): Row[] => {
    if (!sortFieldPath) return input;
    const dir = sort.direction === "asc" ? 1 : -1;
    return [...input].sort(
      (a, b) => compareCellValues(getNested(a, sortFieldPath), getNested(b, sortFieldPath)) * dir,
    );
  };
  const toggleSort = (columnId: string) =>
    setSort((s) =>
      s.columnId === columnId
        ? { columnId, direction: s.direction === "asc" ? "desc" : "asc" }
        : { columnId, direction: "asc" },
    );

  // Effective page size lives in usePagedRows now (the page-size selector calls
  // paged.setPageSize — CLIENT re-slices, CURSOR/OFFSET refetch at the new size).
  const pageSize = paged.pageSize;
  let rows: Row[];
  let page: number;
  let count: number;
  let onPageChange: (target: number) => void;
  if (client) {
    // CLIENT: sort + paginate the full fetched set locally.
    const sorted = sortRows(paged.rows);
    rows = sorted.slice(clientPage * pageSize, (clientPage + 1) * pageSize);
    page = clientPage;
    count = paged.rows.length;
    onPageChange = (target) => setClientPage(target);
  } else {
    // Server modes: paged.rows is already the current page (sort it in place). MUI
    // derives its "X–Y of Z" label + Back/Next from `count` — use the real total
    // whenever the op returns one (OFFSET, or CURSOR now that the aion op computes
    // totalCount); otherwise synthesize from hasNext ("one more page exists").
    rows = sortRows(paged.rows);
    page = paged.page;
    count =
      paged.total !== undefined
        ? paged.total
        : paged.hasNext
          ? (paged.page + 1) * pageSize + 1
          : (paged.page + 1) * pageSize;
    onPageChange = (target) => (target > paged.page ? paged.goNext() : paged.goPrev());
  }

  // Clicking a row opens the entity — the host resolves `(actionId, subject, id)`
  // to the detail route (aion rows carry `id`). Only when a subject + handler exist.
  const onRowClick =
    onAction && subjectKind
      ? (row: Row) => {
          const id = (row as { id?: unknown }).id;
          if (id != null) onAction("open", subjectKind, id as string | number);
        }
      : undefined;

  // "Showing X of Y" only when Y is a real total (CLIENT counts the fetched set;
  // OFFSET and CURSOR read the op's totalCount). Without a total, show just the
  // current count — never a synthesized "of Y" (which would read as a real total).
  const noun = panel.itemNoun || "items";
  const footer =
    rows.length === 0
      ? undefined
      : paged.total !== undefined
        ? `Showing ${rows.length} of ${paged.total} ${noun}`
        : `Showing ${rows.length} ${noun}`;

  // Row actions render INSIDE each row as a ⋮ overflow menu (matching the old
  // studio TableActionsView — not a bar above the table). Two sources merge:
  //  - TablePanel.actions (RowAction[]): fire the RpcCall against THIS row (aion
  //    rows carry `id`, so `{ id: row.id }`).
  //  - View-level ROW-placement actions (MeridianRowActionsContext): an op action
  //    (with a `call`) invokes against the row; a host-resolved action (no call —
  //    edit/view_details → a route) routes to the host's onAction with the row id.
  const viewRowActions = useContext(MeridianRowActionsContext);
  const perRowActions = useMemo<MeridianRowAction<Row>[]>(() => {
    const result: MeridianRowAction<Row>[] = [];
    (panel.actions ?? []).forEach((action, index) => {
      result.push({
        id: `panel-action-${index}`,
        label: action.label,
        onClick: (row: Row) => {
          const id = (row as { id?: unknown }).id;
          if (action.rpc) {
            void invoker.invoke(action.rpc.service, action.rpc.method, id != null ? { id } : {});
          }
        },
      });
    });
    for (const action of viewRowActions) {
      result.push({
        id: action.id,
        label: action.label,
        onClick: (row: Row) => {
          const id = (row as { id?: unknown }).id;
          if (action.call) {
            void invoker.invoke(action.call.service, action.call.method, id != null ? { id } : {});
            return;
          }
          onAction?.(action.id, subjectKind, id as string | number | undefined);
        },
      });
    }
    return result;
  }, [panel.actions, viewRowActions, invoker, onAction, subjectKind]);

  return (
    <Box>
      {paged.error ? (
        <Alert severity="error" className="mer-table-error">
          Failed to load {panel.itemNoun || "items"}.
        </Alert>
      ) : (
        <MeridianTable
          columns={columns}
          rows={rows}
          loading={paged.loading}
          emptyMessage={panel.placeholder || `No ${panel.itemNoun || "items"}.`}
          getRowKey={(row) => String((row as { id?: unknown }).id ?? JSON.stringify(row))}
          pagination={{
            page,
            count,
            pageSize,
            onPageChange,
            // The page-size selector works in every mode now: usePagedRows.setPageSize
            // re-slices (CLIENT) or refetches at the new size (CURSOR/OFFSET).
            pageSizeOptions: TABLE_PAGE_SIZE_OPTIONS,
            onPageSizeChange: (size) => {
              paged.setPageSize(size);
              setClientPage(0);
            },
          }}
          rowActions={perRowActions.length > 0 ? perRowActions : undefined}
          onRowClick={onRowClick}
          sort={{ columnId: sort.columnId, direction: sort.direction, onToggle: toggleSort }}
          footer={footer}
          size="medium"
        />
      )}
    </Box>
  );
}

// ── Forms (Form / Prompt / Lro all render a field form) ──────────────────────

function initValues(fields: FormField[]): Record<string, string | number> {
  const values: Record<string, string | number> = {};
  for (const field of fields) {
    switch (field.kind.case) {
      case "integer":
        values[field.fieldId] = field.kind.value.defaultValue ?? 0;
        break;
      case "enumSelection":
        values[field.fieldId] = field.kind.value.defaultValue ?? "";
        break;
      case "text":
      case "masked":
        values[field.fieldId] = field.kind.value.defaultValue ?? "";
        break;
      default:
        values[field.fieldId] = "";
    }
  }
  return values;
}

function buildFields(
  fields: FormField[],
  values: Record<string, string | number>,
  set: (id: string, value: string | number) => void,
  disabled: boolean,
): MeridianFormField[] {
  return fields.map((field): MeridianFormField => {
    const base = {
      key: field.fieldId,
      label: field.label,
      helperText: field.description || undefined,
      disabled,
    };
    switch (field.kind.case) {
      case "integer":
        return {
          ...base,
          type: "number",
          value: Number(values[field.fieldId] ?? 0),
          onChange: (value: number) => set(field.fieldId, value),
        };
      case "enumSelection":
        return {
          ...base,
          type: "select",
          value: String(values[field.fieldId] ?? ""),
          onChange: (value: string) => set(field.fieldId, value),
          options: field.kind.value.allowedValues.map((value) => ({ value, label: value })),
        };
      default:
        return {
          ...base,
          type: "text",
          value: String(values[field.fieldId] ?? ""),
          onChange: (value: string) => set(field.fieldId, value),
        };
    }
  });
}

function FieldForm({
  fields,
  disabled,
  description,
  submitLabel,
  submitDisabled,
  onSubmit,
}: {
  fields: FormField[];
  disabled: boolean;
  description?: string;
  submitLabel: string;
  submitDisabled?: boolean;
  onSubmit?: (values: Record<string, string | number>) => void;
}): ReactNode {
  const [values, setValues] = useState<Record<string, string | number>>(() =>
    initValues(fields),
  );
  const set = (id: string, value: string | number) =>
    setValues((prev) => ({ ...prev, [id]: value }));
  return (
    <MeridianForm
      fields={buildFields(fields, values, set, disabled)}
      description={description || undefined}
      submit={{ label: submitLabel, disabled: submitDisabled, onSubmit: () => onSubmit?.(values) }}
    />
  );
}

function FormShape({ panel, invoker }: { panel: FormPanel; invoker: RpcInvoker }): ReactNode {
  const edit = panel.mode === FormMode.EDIT;
  return (
    <FieldForm
      fields={panel.fields}
      disabled={!edit}
      submitLabel={edit ? `Save ${panel.itemNoun || ""}`.trim() : "Save"}
      submitDisabled={!edit}
      onSubmit={edit ? (values) => invoke(invoker, panel.submit, values as Row) : undefined}
    />
  );
}

function PromptShape({ panel }: { panel: PromptPanel }): ReactNode {
  return (
    <FieldForm
      fields={panel.fields}
      disabled={false}
      description={panel.description || undefined}
      submitLabel={panel.acceptLabel || "Submit"}
    />
  );
}

function LroShape({ panel, invoker }: { panel: LroPanel; invoker: RpcInvoker }): ReactNode {
  if (panel.inputs.length > 0) {
    return (
      <FieldForm
        fields={panel.inputs}
        disabled={false}
        submitLabel={panel.runButtonLabel || "Run"}
        onSubmit={(values) => invoke(invoker, panel.start, values as Row)}
      />
    );
  }
  return (
    <Button variant="contained" onClick={() => invoke(invoker, panel.start)}>
      {panel.runButtonLabel || "Run"}
    </Button>
  );
}

// ── Chrome / Fallback / ActionBar ────────────────────────────────────────────

function Chrome({
  descriptor,
  children,
}: {
  descriptor: PanelDescriptor;
  children: ReactNode;
}): ReactNode {
  // MeridianMuiProvider already installs the mode-correct MUI ThemeProvider over
  // the whole subtree. Rebuilding a theme here via themeProtoToMuiTheme(theme)
  // dropped the mode → every panel fell back to the LIGHT theme, so dark-mode
  // tables rendered as dim/unreadable text on the dark page. Just wrap the panel;
  // it inherits the provider's (correct-mode) theme.
  return (
    <Box className="mer-panel" data-panel={descriptor.panelId}>
      {children}
    </Box>
  );
}

function Fallback({ descriptor }: { descriptor: PanelDescriptor }): ReactNode {
  return (
    <Alert severity="warning" className="mer-fallback">
      {descriptor.body.case
        ? `unsupported panel shape: ${descriptor.body.case}`
        : "(empty panel)"}
    </Alert>
  );
}

function ActionBar({ actions, invoker }: ActionBarProps): ReactNode {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const { subjectKind } = useContext(MeridianViewContext);
  const onAction = useActionHandler();
  // Fire a header/overflow action: RpcCall actions go through the invoker; no-call
  // actions (host-resolved keys — nav/custom) route to the host's onAction with
  // the view subject (no row id at the header level).
  const fire = (action: Action): void => {
    if (action.call) {
      invoke(invoker, action.call);
      return;
    }
    onAction?.(action.id, subjectKind);
  };
  if (!actions || actions.length === 0) return null;
  // OVERFLOW actions collapse into a kebab (⋮) menu; the rest render inline
  // (PRIMARY = contained, others = outlined). Honors the projected placement.
  const inline = actions.filter((a: Action) => a.placement !== ActionPlacement.OVERFLOW);
  const overflow = actions.filter((a: Action) => a.placement === ActionPlacement.OVERFLOW);
  return (
    <Stack direction="row" spacing={1} alignItems="center" className="mer-actions">
      {inline.map((action: Action) => (
        <Button
          key={action.id}
          size="small"
          variant={action.placement === ActionPlacement.PRIMARY ? "contained" : "outlined"}
          onClick={() => fire(action)}
        >
          {action.label}
        </Button>
      ))}
      {overflow.length > 0 && (
        <>
          <IconButton
            size="small"
            aria-label="more actions"
            className="mer-actions-overflow"
            onClick={(event) => setAnchor(event.currentTarget)}
          >
            <Box component="span" sx={{ fontSize: 20, lineHeight: 1 }}>
              &#8942;
            </Box>
          </IconButton>
          <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
            {overflow.map((action: Action) => (
              <MenuItem
                key={action.id}
                onClick={() => {
                  setAnchor(null);
                  fire(action);
                }}
              >
                {action.label}
              </MenuItem>
            ))}
          </Menu>
        </>
      )}
    </Stack>
  );
}

function themeToStyle(theme: Theme | undefined): CSSProperties {
  const palette = theme?.light;
  if (!palette) return {};
  return { background: palette.bg || undefined, color: palette.fg || undefined };
}

/** The MUI ComponentKit — plug into MeridianProvider / reactWebRenderer. */
export const muiKit: ComponentKit = {
  id: "mui",
  themeToStyle,
  Chrome,
  Table: ({ panel, invoker }: ShapeProps<TablePanel>) => (
    <TableShape panel={panel} invoker={invoker} />
  ),
  Prompt: ({ panel }: ShapeProps<PromptPanel>) => <PromptShape panel={panel} />,
  Lro: ({ panel, invoker }: ShapeProps<LroPanel>) => (
    <LroShape panel={panel} invoker={invoker} />
  ),
  Form: ({ panel, invoker }: ShapeProps<FormPanel>) => (
    <FormShape panel={panel} invoker={invoker} />
  ),
  // ── detail-view shapes (MUI) ────────────────────────────────────────────────
  DetailHeader: ({ panel, invoker }: ShapeProps<DetailHeaderPanel>) => (
    <MeridianDetailHeader panel={panel} invoker={invoker} />
  ),
  RecordCard: ({ panel, invoker }: ShapeProps<RecordCardPanel>) => (
    <MeridianRecordCard panel={panel} invoker={invoker} />
  ),
  // Image/media gallery — lightbox (stage + filmstrip) when the CardSpec has an
  // image_field, else a responsive card grid. See components/gallery.tsx.
  Gallery: ({ panel, invoker }: ShapeProps<GalleryPanel>) => (
    <MeridianGallery panel={panel} invoker={invoker} />
  ),
  // ── content shapes (MUI) ────────────────────────────────────────────────────
  Choice: ({ panel }: ShapeProps<ChoicePanel>) => <ChoiceView panel={panel} />,
  Snippet: ({ panel }: ShapeProps<SnippetPanel>) =>
    panel.snippet ? <SnippetView snippet={panel.snippet} /> : null,
  Action: ({ panel }: ShapeProps<ActionPanel>) => <ActionView panel={panel} />,
  ConnectFlow: ({ panel }: ShapeProps<ConnectFlowPanel>) => (
    <ConnectFlowView panel={panel} />
  ),
  CopyValue: ({ panel }: ShapeProps<CopyValuePanel>) =>
    panel.value ? <CopyValueView value={panel.value} /> : null,
  Catalog: ({ panel }: ShapeProps<CatalogPanel>) => <CatalogView panel={panel} />,
  Grammar: ({ panel }: ShapeProps<GrammarPanel>) => <GrammarView panel={panel} />,
  Stat: ({ panel }: ShapeProps<StatPanel>) => <StatView panel={panel} />,
  Fallback,
  ActionBar,
};

/** @deprecated Back-compat alias — the kit no longer wraps @aion/ui. Use `muiKit`. */
export const aionMuiKit = muiKit;
