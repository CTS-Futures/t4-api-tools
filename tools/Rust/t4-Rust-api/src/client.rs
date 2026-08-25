//! HTTP client for the T4 Chart API (feature `client`).
//!
//! Port of `chart_client.{hpp,cpp}` (JS `client/ChartClient.js`, Python
//! `client/chart_client.py`). Fetches the barchart / tradehistory binary streams
//! and feeds them to the decoders. Uses the blocking [`ureq`] client instead of
//! libcurl; only compiled with `--features client`.
//!
//! The live GET against `https://api-sim.t4login.com/chart` needs a valid T4 sim
//! Bearer token; the binary-payload extraction and decoding are covered by the
//! offline tests.

use std::io::Read;

use crate::error::{DecodeError, Result};
use crate::n_date_time::NDateTime;
use crate::payload::extract_t4bin_payload;
use crate::reader_aggr::{AggrReader, AggrRecord};
use crate::reader_tick::{TickEvent, TickReader};
use crate::ChartDataType;

/// Query parameters for the `/barchart` endpoint.
#[derive(Clone, Debug)]
pub struct BarchartParams {
    pub exchange_id: String,
    pub contract_id: String,
    pub chart_type: String,
    pub bar_interval: String,
    pub bar_period: i32,
    pub trade_date_start: String,
    pub trade_date_end: String,
    pub market_id: Option<String>,
    pub continuation_type: Option<String>,
    pub reset_interval: Option<String>,
}

impl Default for BarchartParams {
    fn default() -> Self {
        BarchartParams {
            exchange_id: String::new(),
            contract_id: String::new(),
            chart_type: "Bar".into(),
            bar_interval: "Minute".into(),
            bar_period: 1,
            trade_date_start: String::new(),
            trade_date_end: String::new(),
            market_id: None,
            continuation_type: None,
            reset_interval: None,
        }
    }
}

/// Query parameters for the `/tradehistory` endpoint.
#[derive(Clone, Debug, Default)]
pub struct TradehistoryParams {
    pub exchange_id: String,
    pub contract_id: String,
    pub market_id: Option<String>,
    pub trade_date_start: Option<String>,
    pub trade_date_end: Option<String>,
    pub start: Option<String>,
    pub end: Option<String>,
    pub since: Option<String>,
}

/// Blocking HTTP client for the T4 Chart API.
pub struct ChartClient {
    token: String,
    base_url: String,
}

impl ChartClient {
    /// The default sim base URL.
    pub const DEFAULT_BASE_URL: &'static str = "https://api-sim.t4login.com/chart";

    /// Create a client with the default sim base URL.
    pub fn new(token: impl Into<String>) -> Result<Self> {
        Self::with_base_url(token, Self::DEFAULT_BASE_URL)
    }

    /// Create a client with a custom base URL.
    pub fn with_base_url(token: impl Into<String>, base_url: impl Into<String>) -> Result<Self> {
        let token = token.into();
        if token.is_empty() {
            return Err(DecodeError::Http("ChartClient: token is required".into()));
        }
        let base_url = base_url.into().trim_end_matches('/').to_string();
        Ok(ChartClient { token, base_url })
    }

    /// Fetch barchart binary and decode it into aggregated records.
    pub fn barchart(&self, params: &BarchartParams) -> Result<Vec<AggrRecord>> {
        let body = self.get("/barchart", &barchart_query(params), "application/octet-stream")?;
        let payload = extract_t4bin_payload(&body)?;
        AggrReader::new(payload).collect()
    }

    /// Fetch tradehistory binary and decode it into tick events.
    pub fn tradehistory(
        &self,
        params: &TradehistoryParams,
        data_type: ChartDataType,
    ) -> Result<Vec<TickEvent>> {
        let body = self.get(
            "/tradehistory",
            &tradehistory_query(params),
            "application/octet-stream",
        )?;
        let payload = extract_t4bin_payload(&body)?;
        let market_id = params.market_id.clone().unwrap_or_default();
        TickReader::new(payload, NDateTime::from_ticks(0), market_id, data_type).collect()
    }

    /// Fetch the raw barchart JSON body.
    pub fn barchart_json(&self, params: &BarchartParams) -> Result<String> {
        let body = self.get("/barchart", &barchart_query(params), "application/json")?;
        Ok(String::from_utf8_lossy(&body).into_owned())
    }

    /// Fetch the raw tradehistory JSON body.
    pub fn tradehistory_json(&self, params: &TradehistoryParams) -> Result<String> {
        let body = self.get("/tradehistory", &tradehistory_query(params), "application/json")?;
        Ok(String::from_utf8_lossy(&body).into_owned())
    }

    /// GET `base_url + path?query` with Authorization/Accept headers; returns the
    /// body bytes. Empty query values are omitted (matching the reference).
    fn get(&self, path: &str, query: &[(&str, String)], accept: &str) -> Result<Vec<u8>> {
        let url = format!("{}{}", self.base_url, path);
        let mut req = ureq::get(&url)
            .set("Authorization", &format!("Bearer {}", self.token))
            .set("Accept", accept)
            .set("User-Agent", "t4decoder/1.0");
        for (k, v) in query {
            if !v.is_empty() {
                req = req.query(k, v);
            }
        }
        match req.call() {
            Ok(resp) => {
                let mut buf = Vec::new();
                resp.into_reader()
                    .read_to_end(&mut buf)
                    .map_err(|e| DecodeError::Http(e.to_string()))?;
                Ok(buf)
            }
            Err(ureq::Error::Status(code, resp)) => {
                let body = resp.into_string().unwrap_or_default();
                let preview: String = body.chars().take(256).collect();
                Err(DecodeError::Http(format!("HTTP {code}: {preview}")))
            }
            Err(e) => Err(DecodeError::Http(e.to_string())),
        }
    }
}

fn barchart_query(p: &BarchartParams) -> Vec<(&'static str, String)> {
    let mut q = vec![
        ("exchangeId", p.exchange_id.clone()),
        ("contractId", p.contract_id.clone()),
        ("chartType", p.chart_type.clone()),
        ("barInterval", p.bar_interval.clone()),
        ("barPeriod", p.bar_period.to_string()),
        ("tradeDateStart", p.trade_date_start.clone()),
        ("tradeDateEnd", p.trade_date_end.clone()),
    ];
    if let Some(v) = &p.market_id {
        q.push(("marketID", v.clone()));
    }
    if let Some(v) = &p.continuation_type {
        q.push(("continuationType", v.clone()));
    }
    if let Some(v) = &p.reset_interval {
        q.push(("resetInterval", v.clone()));
    }
    q
}

fn tradehistory_query(p: &TradehistoryParams) -> Vec<(&'static str, String)> {
    let mut q = vec![
        ("exchangeId", p.exchange_id.clone()),
        ("contractId", p.contract_id.clone()),
    ];
    let opt = [
        ("marketID", &p.market_id),
        ("tradeDateStart", &p.trade_date_start),
        ("tradeDateEnd", &p.trade_date_end),
        ("start", &p.start),
        ("end", &p.end),
        ("since", &p.since),
    ];
    for (k, v) in opt {
        if let Some(v) = v {
            q.push((k, v.clone()));
        }
    }
    q
}
