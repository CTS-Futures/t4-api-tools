//! .NET-style `DateTime`: tick = 100 ns since 0001-01-01 00:00:00.
//!
//! Port of `n_date_time.{hpp,cpp}`. Tick values for real chart data (~6.4e17)
//! fit comfortably in `i64`. Only the decode subset is ported (tick storage +
//! calendar breakdown for `get_bar_start_time` / CSV formatting).

use core::fmt;

const TICKS_PER_MILLISECOND: i64 = 10_000;
const TICKS_PER_SECOND: i64 = TICKS_PER_MILLISECOND * 1000;
const TICKS_PER_MINUTE: i64 = TICKS_PER_SECOND * 60;
const TICKS_PER_HOUR: i64 = TICKS_PER_MINUTE * 60;
const TICKS_PER_DAY: i64 = TICKS_PER_HOUR * 24;

const DAYS_PER_YEAR: i64 = 365;
const DAYS_PER_4_YEARS: i64 = DAYS_PER_YEAR * 4 + 1; // 1461
const DAYS_PER_100_YEARS: i64 = DAYS_PER_4_YEARS * 25 - 1; // 36524
const DAYS_PER_400_YEARS: i64 = DAYS_PER_100_YEARS * 4 + 1; // 146097

const DAYS_TO_MONTH_365: [i32; 13] =
    [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334, 365];
const DAYS_TO_MONTH_366: [i32; 13] =
    [0, 31, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335, 366];

fn is_leap_year(year: i32) -> bool {
    year % 4 == 0 && (year % 100 != 0 || year % 400 == 0)
}

fn date_to_ticks(year: i32, month: i32, day: i32) -> Option<i64> {
    if (1..=9999).contains(&year) && (1..=12).contains(&month) {
        let days = if is_leap_year(year) {
            &DAYS_TO_MONTH_366
        } else {
            &DAYS_TO_MONTH_365
        };
        let dim = days[month as usize] - days[(month - 1) as usize];
        if (1..=dim).contains(&day) {
            let y = (year - 1) as i64;
            let n = y * 365 + y / 4 - y / 100 + y / 400
                + days[(month - 1) as usize] as i64
                + day as i64
                - 1;
            return Some(n * TICKS_PER_DAY);
        }
    }
    None
}

fn time_to_ticks(hour: i32, minute: i32, second: i32) -> Option<i64> {
    if (0..24).contains(&hour) && (0..60).contains(&minute) && (0..60).contains(&second) {
        Some(hour as i64 * TICKS_PER_HOUR
            + minute as i64 * TICKS_PER_MINUTE
            + second as i64 * TICKS_PER_SECOND)
    } else {
        None
    }
}

/// A .NET-style timestamp in 100 ns ticks since 0001-01-01.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord)]
pub struct NDateTime {
    ticks: i64,
}

#[derive(Clone, Copy)]
enum DatePart {
    Year,
    Month,
    Day,
}

impl NDateTime {
    /// Construct from a raw tick count.
    pub fn from_ticks(ticks: i64) -> Self {
        NDateTime { ticks }
    }

    /// Construct from calendar fields.
    ///
    /// # Panics
    /// Panics if the date/time is out of range, mirroring the reference throw.
    pub fn from_ymd_hms(
        year: i32,
        month: i32,
        day: i32,
        hour: i32,
        minute: i32,
        second: i32,
        millisecond: i32,
    ) -> Self {
        let ticks = date_to_ticks(year, month, day).expect("NDateTime: invalid date")
            + time_to_ticks(hour, minute, second).expect("NDateTime: invalid time")
            + millisecond as i64 * TICKS_PER_MILLISECOND;
        NDateTime { ticks }
    }

    /// The raw tick count.
    pub fn ticks(&self) -> i64 {
        self.ticks
    }

    /// Calendar year.
    pub fn year(&self) -> i32 {
        self.date_part(DatePart::Year)
    }

    /// Calendar month (1..=12).
    pub fn month(&self) -> i32 {
        self.date_part(DatePart::Month)
    }

    /// Day of month (1..=31).
    pub fn day(&self) -> i32 {
        self.date_part(DatePart::Day)
    }

    /// Hour of day (0..=23).
    pub fn hour(&self) -> i32 {
        ((self.ticks / TICKS_PER_HOUR) % 24) as i32
    }

    /// Minute (0..=59).
    pub fn minute(&self) -> i32 {
        ((self.ticks / TICKS_PER_MINUTE) % 60) as i32
    }

    /// Second (0..=59).
    pub fn second(&self) -> i32 {
        ((self.ticks / TICKS_PER_SECOND) % 60) as i32
    }

    /// Millisecond (0..=999).
    pub fn millisecond(&self) -> i32 {
        ((self.ticks / TICKS_PER_MILLISECOND) % 1000) as i32
    }

    /// `"YYYY-MM-DD HH:MM:SS.mmm"` — the CSV timestamp form.
    pub fn to_millis_string(&self) -> String {
        format!(
            "{:04}-{:02}-{:02} {:02}:{:02}:{:02}.{:03}",
            self.year(),
            self.month(),
            self.day(),
            self.hour(),
            self.minute(),
            self.second(),
            self.millisecond()
        )
    }

    fn date_part(&self, part: DatePart) -> i32 {
        let mut n = self.ticks / TICKS_PER_DAY;
        let y400 = n / DAYS_PER_400_YEARS;
        n -= y400 * DAYS_PER_400_YEARS;
        let mut y100 = n / DAYS_PER_100_YEARS;
        if y100 == 4 {
            y100 = 3;
        }
        n -= y100 * DAYS_PER_100_YEARS;
        let y4 = n / DAYS_PER_4_YEARS;
        n -= y4 * DAYS_PER_4_YEARS;
        let mut y1 = n / DAYS_PER_YEAR;
        if y1 == 4 {
            y1 = 3;
        }
        if let DatePart::Year = part {
            return (y400 * 400 + y100 * 100 + y4 * 4 + y1 + 1) as i32;
        }
        n -= y1 * DAYS_PER_YEAR;
        let leap = (y1 == 3) && (y4 != 24 || y100 == 3);
        let days = if leap {
            &DAYS_TO_MONTH_366
        } else {
            &DAYS_TO_MONTH_365
        };
        let n_num = n as i32;
        let mut m = (n_num >> 5) + 1;
        while n_num >= days[m as usize] {
            m += 1;
        }
        match part {
            DatePart::Month => m,
            DatePart::Day => n_num - days[(m - 1) as usize] + 1,
            DatePart::Year => unreachable!(),
        }
    }
}

impl fmt::Display for NDateTime {
    /// `"YYYY-MM-DD HH:MM:SS"` (seconds precision).
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "{:04}-{:02}-{:02} {:02}:{:02}:{:02}",
            self.year(),
            self.month(),
            self.day(),
            self.hour(),
            self.minute(),
            self.second()
        )
    }
}
