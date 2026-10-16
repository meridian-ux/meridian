//! Preflight borrowed render inputs before cloning rows or formatting repeated
//! cells. Trusted render APIs remain compatible; untrusted consumers use these.
use crate::{
    proto::{GalleryPanel, TablePanel},
    ProtoPaths, RenderedCard, RenderedRow, RequestBudget,
};
use prost::Message;
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("render construction limit exceeded")]
pub struct RenderLimitExceeded;

fn budget() -> Result<RequestBudget, RenderLimitExceeded> {
    RequestBudget::for_boundary(&Value::Null).map_err(|_| RenderLimitExceeded)
}

/// Standalone value formatting has no repeated descriptor projection.
pub fn admit_formatted_value(value: &Value) -> Result<(), RenderLimitExceeded> {
    let mut budget = budget()?;
    budget.reserve(1024).map_err(|_| RenderLimitExceeded)?;
    budget.admit_copy(value).map_err(|_| RenderLimitExceeded)
}

fn cell(budget: &mut RequestBudget, value: &Value, path: &str) -> Result<(), RenderLimitExceeded> {
    // Cover fixed numeric/temporal expansion and path walking. Charge selected
    // data twice for formatted text plus JSON escaping in the boundary result.
    budget
        .reserve(
            1024usize
                .checked_add(path.len())
                .ok_or(RenderLimitExceeded)?,
        )
        .map_err(|_| RenderLimitExceeded)?;
    budget.admit_copy(value).map_err(|_| RenderLimitExceeded)?;
    budget.admit_copy(value).map_err(|_| RenderLimitExceeded)
}

pub fn render_table_bounded(
    response: &Value,
    table: &TablePanel,
) -> Result<Vec<RenderedRow>, RenderLimitExceeded> {
    if table.encoded_len() > 1024 * 1024 {
        return Err(RenderLimitExceeded);
    }
    let mut budget = budget()?;
    // Headers exist even for an empty response. A byte cap alone still permits
    // hundreds of thousands of default/empty column declarations.
    for column in &table.columns {
        budget
            .reserve(
                1024usize
                    .checked_add(column.header.len())
                    .ok_or(RenderLimitExceeded)?,
            )
            .map_err(|_| RenderLimitExceeded)?;
    }
    if let Value::Array(rows) = ProtoPaths::get(response, &table.rows_field) {
        for row in rows {
            budget.admit_copy(row).map_err(|_| RenderLimitExceeded)?;
            for column in &table.columns {
                cell(
                    &mut budget,
                    ProtoPaths::get(row, &column.field_path),
                    &column.field_path,
                )?;
            }
        }
    }
    Ok(crate::render_table(response, table))
}

pub fn render_gallery_bounded(
    response: &Value,
    gallery: &GalleryPanel,
) -> Result<Vec<RenderedCard>, RenderLimitExceeded> {
    if gallery.encoded_len() > 1024 * 1024 {
        return Err(RenderLimitExceeded);
    }
    let mut budget = budget()?;
    if let Value::Array(rows) = ProtoPaths::get(response, &gallery.rows_field) {
        for row in rows {
            budget.admit_copy(row).map_err(|_| RenderLimitExceeded)?;
            if let Some(card) = gallery.card.as_ref() {
                for path in [
                    &card.title_field,
                    &card.subtitle_field,
                    &card.icon_field,
                    &card.status_field,
                    &card.href_field,
                    &card.action_label_field,
                ] {
                    if !path.is_empty() {
                        cell(&mut budget, ProtoPaths::get(row, path), path)?;
                    }
                }
            }
        }
    }
    Ok(crate::render_gallery(response, gallery))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::proto::{CardSpec, TableColumn};
    use serde_json::json;

    #[test]
    fn table_projection_rejects_repeated_cells_before_building_output() {
        let response = json!({"rows":[{"value":"x".repeat(400_000)}]});
        let mut table = TablePanel {
            rows_field: "rows".into(),
            columns: vec![
                TableColumn {
                    field_path: "value".into(),
                    ..Default::default()
                };
                8
            ],
            ..Default::default()
        };
        assert!(render_table_bounded(&response, &table).is_err());
        table.columns.truncate(1);
        assert_eq!(
            render_table_bounded(&response, &table).unwrap()[0].cells[0].len(),
            400_000
        );
        assert_eq!(
            response["rows"][0]["value"].as_str().unwrap().len(),
            400_000
        );
        table.columns = vec![TableColumn::default(); 4096];
        assert!(render_table_bounded(&json!({"rows":[]}), &table).is_err());
        table.columns.truncate(4095);
        assert!(render_table_bounded(&json!({"rows":[]}), &table).is_ok());
    }

    #[test]
    fn gallery_preflight_counts_raw_and_all_projected_slots() {
        let response = json!({"rows":[{"value":"x".repeat(400_000)}]});
        let mut gallery = GalleryPanel {
            rows_field: "rows".into(),
            card: Some(CardSpec {
                title_field: "value".into(),
                subtitle_field: "value".into(),
                status_field: "value".into(),
                href_field: "value".into(),
                icon_field: "value".into(),
                action_label_field: "value".into(),
                ..Default::default()
            }),
            ..Default::default()
        };
        assert!(render_gallery_bounded(&response, &gallery).is_err());
        gallery.card = Some(CardSpec {
            title_field: "value".into(),
            ..Default::default()
        });
        assert_eq!(
            render_gallery_bounded(&response, &gallery).unwrap()[0]
                .title
                .len(),
            400_000
        );
    }

    #[test]
    fn formatted_value_limit_is_checked_without_copying_the_input() {
        assert!(admit_formatted_value(&json!("x".repeat(5 * 1024 * 1024))).is_err());
        assert!(admit_formatted_value(&json!({"raw":false,"count":0})).is_ok());
    }
}
