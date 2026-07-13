//! REST calls: resolve the default market id, and fetch + decode chart bars.
//!
//! The chart endpoint returns the hand-rolled T4BinAggr binary format, which we
//! decode with the reused `t4decoder` crate (no re-implementation).

use crate::state::{Candle, ContractHit, ExchangeInfo, ExpiryGroup, ExpiryMarket};
use anyhow::{anyhow, Context};
use chrono::{Duration, NaiveDate, Utc};
use t4decoder::{extract_t4bin_payload, AggrReader, AggrRecord};

/// .NET epoch (0001-01-01) in 100ns ticks; subtract to reach the Unix epoch.
const DOTNET_UNIX_EPOCH_TICKS: i64 = 621_355_968_000_000_000;

/// Oldest trade date we page back to before declaring "start of history".
pub const HISTORY_FLOOR: &str = "1990-01-01";

fn ticks_to_unix_ms(ticks: i64) -> i64 {
    (ticks - DOTNET_UNIX_EPOCH_TICKS) / 10_000
}

/// How far back to request bars, per interval (bigger bars -> longer history).
/// Used as the step size for each older-history page.
fn lookback_days(bar_interval: &str) -> i64 {
    match bar_interval {
        "Second" => 1,
        "Hour" => 30,
        "Day" => 365,
        "Week" => 5 * 365,
        _ => 5, // Minute
    }
}

/// How far back the *initial* load reaches — a smaller window than
/// [`lookback_days`] so the first paint decodes far fewer bars. The existing
/// older-history pagination fills the rest as the user scrolls back.
fn initial_lookback_days(bar_interval: &str) -> i64 {
    match bar_interval {
        "Second" => 1,
        "Hour" => 7,
        "Day" => 90,
        "Week" => 365,
        _ => 1, // Minute
    }
}

/// Bar length in seconds for `interval` × `period`, used to bucket live ticks.
pub fn interval_to_secs(bar_interval: &str, bar_period: i32) -> i64 {
    let unit = match bar_interval {
        "Second" => 1,
        "Hour" => 3_600,
        "Day" => 86_400,
        "Week" => 604_800,
        _ => 60, // Minute
    };
    unit * bar_period.max(1) as i64
}

/// Search contracts by free text via `/markets/contracts/search`.
pub async fn search_contracts(
    client: &reqwest::Client,
    api_base: &str,
    token: &str,
    term: &str,
) -> anyhow::Result<Vec<ContractHit>> {
    let url = format!("{}/markets/contracts/search", api_base.trim_end_matches('/'));
    let body: serde_json::Value = client
        .get(url)
        .bearer_auth(token)
        .query(&[("search", term.to_lowercase())])
        .send()
        .await?
        .error_for_status()
        .context("contract search failed")?
        .json()
        .await?;

    let arr = body.as_array().cloned().unwrap_or_default();
    let hits = arr
        .iter()
        .filter_map(|c| {
            let get = |keys: &[&str]| {
                keys.iter()
                    .find_map(|k| c.get(*k).and_then(|v| v.as_str()))
                    .unwrap_or_default()
                    .to_string()
            };
            let exchange_id = get(&["exchangeID", "exchangeId", "exchange_id"]);
            let contract_id = get(&["contractID", "contractId", "contract_id"]);
            if exchange_id.is_empty() || contract_id.is_empty() {
                return None;
            }
            Some(ContractHit {
                exchange_id,
                contract_id,
                description: get(&["description", "Description"]),
            })
        })
        .collect();
    Ok(hits)
}

/// Resolve `exchange`/`contract` to a concrete market id via the picker.
pub async fn first_market(
    client: &reqwest::Client,
    api_base: &str,
    token: &str,
    exchange_id: &str,
    contract_id: &str,
) -> anyhow::Result<String> {
    let url = format!("{}/markets/picker/firstmarket", api_base.trim_end_matches('/'));
    let resp = client
        .get(url)
        .bearer_auth(token)
        .query(&[("exchangeid", exchange_id), ("contractid", contract_id)])
        .send()
        .await?
        .error_for_status()
        .context("firstmarket request failed")?;

    let body: serde_json::Value = resp.json().await?;
    // Accept a few plausible key spellings.
    let market_id = body
        .get("marketID")
        .or_else(|| body.get("marketId"))
        .or_else(|| body.get("market_id"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow!("firstmarket response missing marketID: {body}"))?;

    Ok(market_id.to_string())
}

/// Pull a string field trying several key spellings; empty if none present.
fn str_field(v: &serde_json::Value, keys: &[&str]) -> String {
    keys.iter()
        .find_map(|k| v.get(*k).and_then(|x| x.as_str()))
        .unwrap_or_default()
        .to_string()
}

/// List all exchanges via `/markets/exchanges`, sorted by description.
pub async fn load_exchanges(
    client: &reqwest::Client,
    api_base: &str,
    token: &str,
) -> anyhow::Result<Vec<ExchangeInfo>> {
    let url = format!("{}/markets/exchanges", api_base.trim_end_matches('/'));
    let body: serde_json::Value = client
        .get(url)
        .bearer_auth(token)
        .send()
        .await?
        .error_for_status()
        .context("exchanges request failed")?
        .json()
        .await?;

    let mut out: Vec<ExchangeInfo> = body
        .as_array()
        .map(|a| a.as_slice())
        .unwrap_or_default()
        .iter()
        .filter_map(|e| {
            let exchange_id = str_field(e, &["exchangeId", "exchangeID", "exchange_id"]);
            if exchange_id.is_empty() {
                return None;
            }
            Some(ExchangeInfo {
                exchange_id,
                description: str_field(e, &["description", "Description"]),
            })
        })
        .collect();
    out.sort_by(|a, b| a.description.cmp(&b.description));
    Ok(out)
}

/// List the contracts under an exchange via `/markets/contracts`.
pub async fn load_contracts(
    client: &reqwest::Client,
    api_base: &str,
    token: &str,
    exchange_id: &str,
) -> anyhow::Result<Vec<ContractHit>> {
    let url = format!("{}/markets/contracts", api_base.trim_end_matches('/'));
    let body: serde_json::Value = client
        .get(url)
        .bearer_auth(token)
        .query(&[("exchangeid", exchange_id)])
        .send()
        .await?
        .error_for_status()
        .context("contracts request failed")?
        .json()
        .await?;

    let hits = body
        .as_array()
        .map(|a| a.as_slice())
        .unwrap_or_default()
        .iter()
        .filter_map(|c| {
            let contract_id = str_field(c, &["contractID", "contractId", "contract_id"]);
            if contract_id.is_empty() {
                return None;
            }
            let ex = str_field(c, &["exchangeID", "exchangeId", "exchange_id"]);
            Some(ContractHit {
                exchange_id: if ex.is_empty() { exchange_id.to_string() } else { ex },
                contract_id,
                description: str_field(c, &["description", "Description"]),
            })
        })
        .collect();
    Ok(hits)
}

/// List expiry groups for a contract via `/markets/picker/groups`.
pub async fn load_expiry_groups(
    client: &reqwest::Client,
    api_base: &str,
    token: &str,
    exchange_id: &str,
    contract_id: &str,
) -> anyhow::Result<Vec<ExpiryGroup>> {
    let url = format!("{}/markets/picker/groups", api_base.trim_end_matches('/'));
    let body: serde_json::Value = client
        .get(url)
        .bearer_auth(token)
        .query(&[("exchangeid", exchange_id), ("contractid", contract_id)])
        .send()
        .await?
        .error_for_status()
        .context("expiry groups request failed")?
        .json()
        .await?;

    let groups = body
        .as_array()
        .map(|a| a.as_slice())
        .unwrap_or_default()
        .iter()
        .filter_map(|g| {
            let strategy_type = str_field(g, &["strategyType", "strategytype", "strategy_type"]);
            if strategy_type.is_empty() {
                return None;
            }
            let market_count = g
                .get("marketCount")
                .or_else(|| g.get("marketcount"))
                .and_then(|v| v.as_i64())
                .unwrap_or(0) as i32;
            Some(ExpiryGroup {
                strategy_type,
                expiry_date: str_field(g, &["expiryDate", "expirydate", "expiry_date"]),
                market_count,
            })
        })
        .collect();
    Ok(groups)
}

/// List markets under an expiry group via `/markets/picker`. Per the JS/Python
/// demos, `expirydate` is sent only for non-"None" strategies with a date.
#[allow(clippy::too_many_arguments)]
pub async fn load_expiry_markets(
    client: &reqwest::Client,
    api_base: &str,
    token: &str,
    exchange_id: &str,
    contract_id: &str,
    strategy_type: &str,
    expiry_date: &str,
) -> anyhow::Result<Vec<ExpiryMarket>> {
    let url = format!("{}/markets/picker", api_base.trim_end_matches('/'));
    let mut query: Vec<(&str, &str)> = vec![
        ("exchangeid", exchange_id),
        ("contractid", contract_id),
        ("strategytype", strategy_type),
    ];
    if strategy_type != "None" && !expiry_date.is_empty() {
        query.push(("expirydate", expiry_date));
    }
    let body: serde_json::Value = client
        .get(url)
        .bearer_auth(token)
        .query(&query)
        .send()
        .await?
        .error_for_status()
        .context("expiry markets request failed")?
        .json()
        .await?;

    let markets = body
        .as_array()
        .map(|a| a.as_slice())
        .unwrap_or_default()
        .iter()
        .filter_map(|m| {
            let market_id = str_field(m, &["marketID", "marketId", "market_id"]);
            if market_id.is_empty() {
                return None;
            }
            Some(ExpiryMarket {
                market_id,
                expiry_date: str_field(m, &["expiryDate", "expirydate", "expiry_date"]),
                description: str_field(m, &["description", "Description"]),
            })
        })
        .collect();
    Ok(markets)
}

/// Fetch and decode OHLCV bars for a market over the initial lookback window
/// (`today - initial_lookback_days(interval) … today`) — deliberately small so
/// the first paint is fast; older history streams in via `fetch_older`. Returns
/// the bars plus the window start date so callers can page further back.
#[allow(clippy::too_many_arguments)]
pub async fn fetch_chart(
    client: &reqwest::Client,
    api_base: &str,
    token: &str,
    exchange_id: &str,
    contract_id: &str,
    market_id: &str,
    bar_interval: &str,
    bar_period: i32,
) -> anyhow::Result<(Vec<Candle>, NaiveDate, String)> {
    let today = Utc::now().date_naive();
    let start = today - Duration::days(initial_lookback_days(bar_interval));
    let (candles, format) = fetch_chart_range(
        client, api_base, token, exchange_id, contract_id, market_id, bar_interval, bar_period,
        start, today,
    )
    .await?;
    Ok((candles, start, format))
}

/// Fetch and decode OHLCV bars for an explicit `[start, end]` trade-date range.
#[allow(clippy::too_many_arguments)]
pub async fn fetch_chart_range(
    client: &reqwest::Client,
    api_base: &str,
    token: &str,
    exchange_id: &str,
    contract_id: &str,
    market_id: &str,
    bar_interval: &str,
    bar_period: i32,
    start: NaiveDate,
    end: NaiveDate,
) -> anyhow::Result<(Vec<Candle>, String)> {
    let url = format!("{}/chart/barchart", api_base.trim_end_matches('/'));
    let period = bar_period.to_string();
    let start_s = start.format("%Y-%m-%d").to_string();
    let end_s = end.format("%Y-%m-%d").to_string();

    let mut query: Vec<(&str, &str)> = vec![
        ("exchangeId", exchange_id),
        ("contractId", contract_id),
        ("chartType", "Bar"),
        ("barInterval", bar_interval),
        ("barPeriod", &period),
        ("tradeDateStart", &start_s),
        ("tradeDateEnd", &end_s),
    ];
    if !market_id.is_empty() {
        query.push(("marketID", market_id));
    }

    // The binary T4BinAggr stream is only returned when octet-stream is
    // requested; without this header the server returns JSON (no SOF signature).
    let resp = client
        .get(url)
        .bearer_auth(token)
        .header(reqwest::header::ACCEPT, "application/octet-stream")
        .query(&query)
        .send()
        .await?
        .error_for_status()
        .context("barchart request failed")?;

    // Note the wire format the server actually replied with before consuming
    // the body, so the UI/heartbeat can report binary vs JSON.
    let content_type = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let bytes = resp.bytes().await?;
    let format = detect_chart_format(&content_type, &bytes);

    Ok((decode_bars(&bytes)?, format))
}

/// Human-readable description of the wire format a chart response arrived in,
/// for status/logging. Prefers the actual T4Bin SOF marker (so it matches what
/// the decoder sees), then falls back to the Content-Type / body shape.
fn detect_chart_format(content_type: &str, body: &[u8]) -> String {
    let ct = content_type.to_ascii_lowercase();
    if body.is_empty() {
        "empty".to_string()
    } else if extract_t4bin_payload(body).is_ok() {
        "binary (T4BinAggr)".to_string()
    } else if ct.contains("json") || matches!(body.first(), Some(b'{' | b'[')) {
        "JSON".to_string()
    } else if ct.is_empty() {
        "unknown".to_string()
    } else {
        format!("other ({content_type})")
    }
}

/// The outcome of paging back for older bars.
pub struct OlderPage {
    /// Bars found (chronological); may be empty if we hit the floor.
    pub candles: Vec<Candle>,
    /// New earliest date fetched — the next page steps back from here.
    pub window_start: NaiveDate,
    /// True once we've reached the history floor and there's nothing older.
    pub reached_floor: bool,
}

/// Page backwards from `window_start`, stepping one `lookback_days` chunk at a
/// time and skipping empty chunks (weekends/holidays), until bars are found or
/// the [`HISTORY_FLOOR`] is reached. Mirrors `CPPDemo::fetchOlderChunk`.
#[allow(clippy::too_many_arguments)]
pub async fn fetch_older(
    client: &reqwest::Client,
    api_base: &str,
    token: &str,
    exchange_id: &str,
    contract_id: &str,
    market_id: &str,
    bar_interval: &str,
    bar_period: i32,
    window_start: NaiveDate,
) -> anyhow::Result<OlderPage> {
    let floor: NaiveDate = HISTORY_FLOOR.parse().unwrap_or(window_start);
    let step = Duration::days(lookback_days(bar_interval));

    let mut end = window_start;
    for _ in 0..8 {
        if end <= floor {
            return Ok(OlderPage { candles: vec![], window_start: floor, reached_floor: true });
        }
        let mut start = end - step;
        let at_floor = start <= floor;
        if at_floor {
            start = floor;
        }

        // Older pages hit the same endpoint with the same Accept header, so the
        // format is identical to the initial load; the heartbeat already has it.
        let (candles, _format) = fetch_chart_range(
            client, api_base, token, exchange_id, contract_id, market_id, bar_interval,
            bar_period, start, end,
        )
        .await?;

        if !candles.is_empty() {
            return Ok(OlderPage { candles, window_start: start, reached_floor: at_floor });
        }
        if at_floor {
            return Ok(OlderPage { candles: vec![], window_start: floor, reached_floor: true });
        }
        end = start;
    }
    // Exhausted attempts without data; report progress but not floor.
    Ok(OlderPage { candles: vec![], window_start: end, reached_floor: false })
}

/// Decode a T4BinAggr response body into candles using `t4decoder`.
fn decode_bars(response: &[u8]) -> anyhow::Result<Vec<Candle>> {
    let payload = extract_t4bin_payload(response).map_err(|e| {
        let preview: String = String::from_utf8_lossy(response).chars().take(200).collect();
        anyhow!(
            "failed to extract T4Bin payload: {e:?} ({} bytes, starts: {preview:?})",
            response.len()
        )
    })?;

    let mut candles = Vec::new();
    for rec in AggrReader::new(payload) {
        match rec {
            Ok(AggrRecord::Bar(bar)) => {
                candles.push(Candle {
                    time_ms: ticks_to_unix_ms(bar.time.ticks()),
                    open: price_f64(&bar.open_price),
                    high: price_f64(&bar.high_price),
                    low: price_f64(&bar.low_price),
                    close: price_f64(&bar.close_price),
                    volume: bar.volume,
                });
            }
            Ok(_) => {}
            Err(e) => return Err(anyhow!("chart decode error: {e:?}")),
        }
    }
    Ok(candles)
}

fn price_f64(p: &t4decoder::Price) -> f64 {
    p.value().to_string().parse::<f64>().unwrap_or(0.0)
}
