// MeridianForm — the kit's own MUI form (lifted from @aion/ui's FormView pattern,
// generalized + dependency-free). Renders typed field descriptors — scalars
// (text / number / decimal / boolean / select) plus recursive shapes (group for a
// NestedForm, list for a RepeatedField with add/remove) — as MUI inputs in a Card,
// with a submit button. READONLY detail cards use `disabled` fields (and hide
// add/remove); EDIT forms wire onChange + submit.

import type { ReactNode } from "react";

import {
  Box,
  Button,
  Card,
  CardContent,
  FormControlLabel,
  IconButton,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";

interface BaseField {
  key: string;
  label: string;
  helperText?: string;
  disabled?: boolean;
}
interface NumericField {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
}
export type MeridianFormField =
  | (BaseField & { type?: "text"; value: string; onChange: (value: string) => void })
  // `number` = integer spinner (parseInt); `decimal` = floating-point (parseFloat).
  | (BaseField & { type: "number" } & NumericField)
  | (BaseField & { type: "decimal" } & NumericField)
  | (BaseField & { type: "boolean"; value: boolean; onChange: (value: boolean) => void })
  | (BaseField & {
      type: "select";
      value: string;
      onChange: (value: string) => void;
      options: { value: string; label: string }[];
    })
  // A nested object → a titled sub-group of fields (NestedForm).
  | (BaseField & { type: "group"; fields: MeridianFormField[] })
  // A repeated field → an add/remove/reorder list, each element rendered from RepeatedField.item.
  | (BaseField & {
      type: "list";
      items: MeridianFormField[];
      addLabel: string;
      canAdd: boolean;
      canRemove: boolean;
      onAdd: () => void;
      onRemove: (index: number) => void;
      onMoveUp: (index: number) => void;
      onMoveDown: (index: number) => void;
    });

export interface MeridianFormSubmit {
  label: string;
  onSubmit: () => void;
  disabled?: boolean;
}

export interface MeridianFormProps {
  title?: string;
  description?: ReactNode;
  fields: MeridianFormField[];
  submit: MeridianFormSubmit;
}

type NumericFormField = Extract<MeridianFormField, { type: "number" | "decimal" }>;

/** Integer (`number`, parseInt) and decimal (`decimal`, parseFloat) share a spinner. */
function renderNumeric(field: NumericFormField): ReactNode {
  const integer = field.type === "number";
  return (
    <TextField
      key={field.key}
      fullWidth
      type="number"
      label={field.label}
      value={field.value}
      helperText={field.helperText}
      disabled={field.disabled}
      slotProps={{ htmlInput: { min: field.min, max: field.max, step: field.step ?? (integer ? 1 : "any") } }}
      onChange={(event) => {
        const parsed = integer
          ? Number.parseInt(event.target.value, 10)
          : Number.parseFloat(event.target.value);
        field.onChange(Number.isNaN(parsed) ? 0 : parsed);
      }}
    />
  );
}

function renderField(field: MeridianFormField): ReactNode {
  // A nested object → a titled fieldset of sub-fields (recurses).
  if (field.type === "group") {
    return (
      <Box
        key={field.key}
        component="fieldset"
        sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 2, m: 0, minWidth: 0 }}
      >
        <Typography component="legend" variant="subtitle2" sx={{ px: 0.5 }}>
          {field.label}
        </Typography>
        {field.helperText ? (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
            {field.helperText}
          </Typography>
        ) : null}
        <Stack spacing={2}>{field.fields.map(renderField)}</Stack>
      </Box>
    );
  }
  // A repeated field → each element rendered + a remove button, plus an add button.
  // Add/remove are hidden on READONLY (disabled) forms; bounds gate canAdd/canRemove.
  if (field.type === "list") {
    const showControls = !field.disabled;
    return (
      <Box key={field.key} sx={{ minWidth: 0 }}>
        <Typography variant="subtitle2" gutterBottom>
          {field.label}
        </Typography>
        {field.helperText ? (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
            {field.helperText}
          </Typography>
        ) : null}
        <Stack spacing={1}>
          {field.items.map((item, index) => (
            <Stack key={item.key} direction="row" spacing={1} alignItems="flex-start">
              <Box sx={{ flex: 1, minWidth: 0 }}>{renderField(item)}</Box>
              {showControls ? (
                <Stack direction="column" spacing={0} sx={{ mt: 0.5 }}>
                  <IconButton
                    aria-label="move item up"
                    size="small"
                    disabled={index === 0}
                    onClick={() => field.onMoveUp(index)}
                  >
                    <Box component="span" sx={{ fontSize: 16, lineHeight: 1 }}>
                      &#8593;
                    </Box>
                  </IconButton>
                  <IconButton
                    aria-label="move item down"
                    size="small"
                    disabled={index === field.items.length - 1}
                    onClick={() => field.onMoveDown(index)}
                  >
                    <Box component="span" sx={{ fontSize: 16, lineHeight: 1 }}>
                      &#8595;
                    </Box>
                  </IconButton>
                </Stack>
              ) : null}
              {showControls ? (
                <IconButton
                  aria-label="remove item"
                  size="small"
                  disabled={!field.canRemove}
                  onClick={() => field.onRemove(index)}
                  sx={{ mt: 1 }}
                >
                  <Box component="span" sx={{ fontSize: 18, lineHeight: 1 }}>
                    &#10005;
                  </Box>
                </IconButton>
              ) : null}
            </Stack>
          ))}
          {field.items.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              (none)
            </Typography>
          ) : null}
        </Stack>
        {showControls ? (
          <Button size="small" onClick={field.onAdd} disabled={!field.canAdd} sx={{ mt: 1 }}>
            {field.addLabel}
          </Button>
        ) : null}
      </Box>
    );
  }
  if (field.type === "boolean") {
    return (
      <Box key={field.key}>
        <FormControlLabel
          control={
            <Switch
              checked={field.value}
              disabled={field.disabled}
              onChange={(event) => field.onChange(event.target.checked)}
            />
          }
          label={field.label}
        />
        {field.helperText ? (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
            {field.helperText}
          </Typography>
        ) : null}
      </Box>
    );
  }
  if (field.type === "select") {
    return (
      <TextField
        key={field.key}
        select
        fullWidth
        label={field.label}
        value={field.value}
        helperText={field.helperText}
        disabled={field.disabled}
        onChange={(event) => field.onChange(event.target.value)}
      >
        {field.options.map((option) => (
          <MenuItem key={option.value} value={option.value}>
            {option.label}
          </MenuItem>
        ))}
      </TextField>
    );
  }
  if (field.type === "number" || field.type === "decimal") {
    return renderNumeric(field);
  }
  return (
    <TextField
      key={field.key}
      fullWidth
      label={field.label}
      value={field.value}
      helperText={field.helperText}
      disabled={field.disabled}
      onChange={(event) => field.onChange(event.target.value)}
    />
  );
}

export function MeridianForm({
  title,
  description,
  fields,
  submit,
}: MeridianFormProps): ReactNode {
  return (
    <Card variant="outlined">
      <CardContent>
        <Box
          component="form"
          onSubmit={(event) => {
            event.preventDefault();
            submit.onSubmit();
          }}
        >
          {title ? (
            <Typography variant="h6" gutterBottom>
              {title}
            </Typography>
          ) : null}
          {description ? <Box sx={{ mb: 2 }}>{description}</Box> : null}
          <Stack spacing={2}>
            {fields.map(renderField)}
            <Button type="submit" variant="contained" disabled={submit.disabled}>
              {submit.label}
            </Button>
          </Stack>
        </Box>
      </CardContent>
    </Card>
  );
}
