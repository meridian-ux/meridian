// aionMuiKit — a meridian ComponentKit that paints panels with the aion MUI
// component set (@aion/ui). It is one implementation of the ComponentKit
// interface exported by @savvifi/meridian-web-react, a peer of htmlKit /
// shadcnKit: the kit-agnostic PanelRenderer / ViewRenderer dispatch the
// descriptor shapes to these components, so the same ViewDescriptor renders
// here with MUI tables + forms (and aion's built-in table pagination) instead
// of plain HTML.
//
// The kit WRAPS the published @aion/ui components (DataTableView, FormView)
// rather than reimplementing them — so the MUI look, the reducers, and the
// hooks the app already relies on are reused verbatim. Later ("lift") the
// genuinely-general primitives migrate into this package so it no longer
// depends on @aion/ui.

import { useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

import { DataTableView, type Column } from "@aion/ui/data-display/table/DataTableView";
import {
  FormView,
  type FormFieldDescriptor,
  type FormSubmitConfig,
} from "@aion/ui/layout/FormView";
import { Alert, Box, Button, Stack, TablePagination } from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";

import type {
  ActionBarProps,
  ComponentKit,
  ShapeProps,
} from "@savvifi/meridian-web-react";
import {
  PaginationMode,
  useMeridianTheme,
  usePagedRows,
} from "@savvifi/meridian-web-react";
import type { FormField } from "@savvifi/meridian-proto-ts/proto/form_pb.js";
import type { LroPanel } from "@savvifi/meridian-proto-ts/proto/lro_pb.js";
import {
  FormMode,
  type FormPanel,
  type PanelDescriptor,
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
import type { RpcInvoker } from "@savvifi/meridian-schemas/uiview";

import { themeProtoToMuiTheme } from "./theme.js";

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

function TableShape({ panel, invoker }: { panel: TablePanel; invoker: RpcInvoker }): ReactNode {
  // usePagedRows (from meridian-web-react) is the kit-agnostic pagination brain:
  // CLIENT returns all fetched rows (DataTableView paginates them locally — aion's
  // own MUI pager, which the app relies on); OFFSET / CURSOR fetch one page at a
  // time via the invoker and we render a MUI TablePagination footer to drive it.
  const paged = usePagedRows(panel, invoker);
  const client = paged.mode === PaginationMode.CLIENT;

  const columns = useMemo<Column<Row>[]>(
    () =>
      panel.columns.map((col: TableColumn, index) => ({
        id: col.fieldPath || col.header || String(index),
        label: col.header,
        width: col.prefWidth || undefined,
        render: (row: Row) => formatCell(getNested(row, col.fieldPath), col.format),
      })),
    [panel.columns],
  );

  const rowActions = panel.actions ?? [];

  const serverFooter = client ? undefined : (
    <TablePagination
      component="div"
      count={paged.total ?? -1}
      page={paged.page}
      rowsPerPage={paged.pageSize}
      rowsPerPageOptions={[paged.pageSize]}
      onPageChange={(_event, next) =>
        next > paged.page ? paged.goNext() : paged.goPrev()
      }
      slotProps={{
        actions: {
          nextButton: { disabled: !paged.hasNext },
          previousButton: { disabled: !paged.hasPrev },
        },
      }}
    />
  );

  return (
    <Box>
      {rowActions.length > 0 && (
        <Stack direction="row" spacing={1} sx={{ mb: 1 }} className="mer-row-actions">
          {rowActions.map((action, index) => (
            <Button
              key={index}
              size="small"
              variant="outlined"
              onClick={() => invoke(invoker, action.rpc)}
            >
              {action.label}
            </Button>
          ))}
        </Stack>
      )}
      <DataTableView
        columns={columns}
        rows={paged.rows}
        isLoading={paged.loading}
        emptyMessage={panel.placeholder || `No ${panel.itemNoun || "items"}.`}
        // CLIENT ⇒ DataTableView's own pager over all rows; server modes page
        // externally (paged.rows is already the current page) with a MUI footer.
        paginated={client}
        pageSize={paged.pageSize}
        footer={serverFooter}
        getRowKey={(row) =>
          String((row as { id?: unknown }).id ?? JSON.stringify(row))
        }
      />
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

function buildDescriptors(
  fields: FormField[],
  values: Record<string, string | number>,
  set: (id: string, value: string | number) => void,
  disabled: boolean,
): FormFieldDescriptor[] {
  return fields.map((field): FormFieldDescriptor => {
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
          options: field.kind.value.allowedValues.map((value) => ({
            value,
            label: value,
          })),
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
  const descriptors = buildDescriptors(fields, values, set, disabled);
  const submit: FormSubmitConfig = {
    label: submitLabel,
    disabled: submitDisabled,
    onSubmit: () => onSubmit?.(values),
  };
  return (
    <FormView
      fields={descriptors}
      description={description || undefined}
      submit={submit}
      variant="card"
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
      onSubmit={
        edit
          ? (values) => invoke(invoker, panel.submit, values as Row)
          : undefined
      }
    />
  );
}

function PromptShape({ panel }: { panel: PromptPanel }): ReactNode {
  // A standalone input collector: no RPC side effect (values return to the
  // in-process caller). The web kit renders the form; wiring the return value
  // is host-specific.
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
  // Bind the meridian Theme to MUI per panel, so the single-panel
  // reactWebRenderer(aionMuiKit) mount path is themed too (the view path also
  // gets one theme provider from MeridianMuiProvider — nesting the same theme
  // is harmless).
  const theme = useMeridianTheme();
  const muiTheme = useMemo(() => themeProtoToMuiTheme(theme), [theme]);
  return (
    <ThemeProvider theme={muiTheme}>
      <Box className="mer-panel" data-panel={descriptor.panelId}>
        {children}
      </Box>
    </ThemeProvider>
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
  if (!actions || actions.length === 0) return null;
  return (
    <Stack direction="row" spacing={1} className="mer-actions">
      {actions.map((action: Action) => (
        <Button
          key={action.id}
          size="small"
          variant={
            action.placement === ActionPlacement.PRIMARY ? "contained" : "outlined"
          }
          onClick={() => invoke(invoker, action.call)}
        >
          {action.label}
        </Button>
      ))}
    </Stack>
  );
}

function themeToStyle(theme: Theme | undefined): CSSProperties {
  const palette = theme?.light;
  if (!palette) return {};
  return {
    background: palette.bg || undefined,
    color: palette.fg || undefined,
  };
}

/** The aion MUI ComponentKit — plug into MeridianProvider / reactWebRenderer. */
export const aionMuiKit: ComponentKit = {
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
  Fallback,
  ActionBar,
};
