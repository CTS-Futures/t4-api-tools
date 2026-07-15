//! Small definition enums. Underlying values match the Java/Python/JS sources.

/// Which side of the market a trade executed against.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
#[repr(i32)]
pub enum BidOffer {
    /// No side set.
    #[default]
    Undefined = 0,
    /// Traded at the bid.
    Bid = 1,
    /// Traded at the offer.
    Offer = -1,
}

impl BidOffer {
    /// Map a raw wire value.
    pub fn from_int(v: i32) -> Self {
        match v {
            1 => BidOffer::Bid,
            -1 => BidOffer::Offer,
            _ => BidOffer::Undefined,
        }
    }
}

/// Exchange session lifecycle states (0..=15).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
#[repr(i32)]
pub enum MarketMode {
    /// No mode set.
    #[default]
    Undefined = 0,
    PreOpen = 1,
    Open = 2,
    RestrictedOpen = 3,
    PreClosed = 4,
    Closed = 5,
    Suspended = 6,
    Halted = 7,
    Failed = 8,
    PreCross = 9,
    Cross = 10,
    Expired = 11,
    Rejected = 12,
    Unavailable = 13,
    NoPermission = 14,
    TrialExpired = 15,
}

impl MarketMode {
    /// Map a raw wire value; anything out of range → `Undefined`.
    pub fn from_int(v: i32) -> Self {
        match v {
            1 => MarketMode::PreOpen,
            2 => MarketMode::Open,
            3 => MarketMode::RestrictedOpen,
            4 => MarketMode::PreClosed,
            5 => MarketMode::Closed,
            6 => MarketMode::Suspended,
            7 => MarketMode::Halted,
            8 => MarketMode::Failed,
            9 => MarketMode::PreCross,
            10 => MarketMode::Cross,
            11 => MarketMode::Expired,
            12 => MarketMode::Rejected,
            13 => MarketMode::Unavailable,
            14 => MarketMode::NoPermission,
            15 => MarketMode::TrialExpired,
            _ => MarketMode::Undefined,
        }
    }

    /// The raw integer value.
    pub fn as_int(self) -> i32 {
        self as i32
    }
}

/// The kind of change a reader last applied to [`ChartDataState`](crate::ChartDataState).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
#[repr(i32)]
pub enum ChartDataChange {
    /// No change.
    #[default]
    None = 0,
    Trade = 1,
    Quote = 2,
    MarketMode = 3,
    Settlement = 4,
    TradeBar = 5,
    TradeDate = 6,
    Tpo = 7,
    TickChange = 8,
    Rfq = 9,
    HeldSettlement = 10,
    ClearedVolume = 11,
    OpenInterest = 12,
    Vwap = 13,
    MarketSwitch = 14,
    MarketDefinition = 15,
}

/// Aggregation type. Values match the Java static instances; unknown wire
/// values map to `Tick` (the `get_bar_start_time` default branch returns the raw
/// time for anything not Second/Minute/Hour/Day/TPO).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
#[repr(i32)]
pub enum ChartDataType {
    /// Tick-level (no aggregation).
    #[default]
    Tick = 0,
    Second = 1,
    Minute = 2,
    Hour = 3,
    Day = 4,
    Tpo = 5,
    TickChange = 6,
}

impl ChartDataType {
    /// Map a raw wire value; anything out of range → `Tick`.
    pub fn from_int(v: i32) -> Self {
        match v {
            1 => ChartDataType::Second,
            2 => ChartDataType::Minute,
            3 => ChartDataType::Hour,
            4 => ChartDataType::Day,
            5 => ChartDataType::Tpo,
            6 => ChartDataType::TickChange,
            _ => ChartDataType::Tick,
        }
    }
}
