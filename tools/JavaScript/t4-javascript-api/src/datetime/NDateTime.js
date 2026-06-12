/**
 * Port of `com.t4login.datetime.NDateTime`.
 *
 * .NET-style DateTime with tick = 100 ns since 0001-01-01 00:00:00.
 * All tick arithmetic uses BigInt because raw tick values exceed Number's
 * safe-integer range (`Date.now() * 10000n + 621355968000000000n` for
 * current dates is ~6.4e17).
 */

export const TICKS_PER_MILLISECOND = 10_000n;
export const TICKS_PER_SECOND = TICKS_PER_MILLISECOND * 1_000n;
export const TICKS_PER_MINUTE = TICKS_PER_SECOND * 60n;
export const TICKS_PER_HOUR = TICKS_PER_MINUTE * 60n;
export const TICKS_PER_DAY = TICKS_PER_HOUR * 24n;

const DAYS_PER_YEAR = 365n;
const DAYS_PER_4_YEARS = DAYS_PER_YEAR * 4n + 1n; // 1461
const DAYS_PER_100_YEARS = DAYS_PER_4_YEARS * 25n - 1n; // 36524
const DAYS_PER_400_YEARS = DAYS_PER_100_YEARS * 4n + 1n; // 146097
const DAYS_TO_10000 = DAYS_PER_400_YEARS * 25n - 366n; // 3652059

export const MIN_TICKS = 0n;
export const MAX_TICKS = DAYS_TO_10000 * TICKS_PER_DAY - 1n;

const DAYS_TO_MONTH_365 = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334, 365];
const DAYS_TO_MONTH_366 = [0, 31, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335, 366];

const DATE_PART_YEAR = 0;
const DATE_PART_DAY_OF_YEAR = 1;
const DATE_PART_MONTH = 2;
const DATE_PART_DAY = 3;

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function dateToTicks(year, month, day) {
  if (year >= 1 && year <= 9999 && month >= 1 && month <= 12) {
    const days = isLeapYear(year) ? DAYS_TO_MONTH_366 : DAYS_TO_MONTH_365;
    if (day >= 1 && day <= days[month] - days[month - 1]) {
      const y = year - 1;
      const n =
        y * 365 +
        Math.floor(y / 4) -
        Math.floor(y / 100) +
        Math.floor(y / 400) +
        days[month - 1] +
        day -
        1;
      return BigInt(n) * TICKS_PER_DAY;
    }
  }
  throw new RangeError(`Invalid date: ${year}-${month}-${day}`);
}

function timeToTicks(hour, minute, second) {
  if (hour >= 0 && hour < 24 && minute >= 0 && minute < 60 && second >= 0 && second < 60) {
    return (
      BigInt(hour) * TICKS_PER_HOUR +
      BigInt(minute) * TICKS_PER_MINUTE +
      BigInt(second) * TICKS_PER_SECOND
    );
  }
  throw new RangeError(`Invalid time: ${hour}:${minute}:${second}`);
}

/**
 * Convert a value of any of these forms into a BigInt tick count:
 *   - bigint (returned as-is)
 *   - number (coerced via BigInt; throws if not integral and >2^53)
 *   - NDateTime (its .ticks)
 * @param {bigint | number | NDateTime} v
 * @returns {bigint}
 */
export function toTicks(v) {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') return BigInt(v);
  if (v instanceof NDateTime) return v.ticks;
  throw new TypeError('toTicks: unsupported argument type');
}

export class NDateTime {
  /**
   * Either `new NDateTime(ticks)` (bigint or number), or
   * `new NDateTime(year, month, day, hour?, minute?, second?, millisecond?)`.
   */
  constructor(ticksOrYear, month, day, hour = 0, minute = 0, second = 0, millisecond = 0) {
    let ticks;
    if (month === undefined) {
      ticks = typeof ticksOrYear === 'bigint' ? ticksOrYear : BigInt(ticksOrYear);
    } else {
      if (day === undefined) {
        throw new RangeError('day must be provided when month is given');
      }
      ticks =
        dateToTicks(ticksOrYear, month, day) +
        timeToTicks(hour, minute, second) +
        BigInt(millisecond) * TICKS_PER_MILLISECOND;
    }
    if (ticks < MIN_TICKS || ticks > MAX_TICKS) {
      throw new RangeError(`Ticks out of range: ${ticks}`);
    }
    this._ticks = ticks;
  }

  /** @returns {bigint} */
  get ticks() {
    return this._ticks;
  }

  getTicks() {
    return this._ticks;
  }

  _getDatePart(part) {
    // All BigInt arithmetic, then convert the final small number to Number.
    let n = this._ticks / TICKS_PER_DAY;
    let y400 = n / DAYS_PER_400_YEARS;
    n -= y400 * DAYS_PER_400_YEARS;
    let y100 = n / DAYS_PER_100_YEARS;
    if (y100 === 4n) y100 = 3n;
    n -= y100 * DAYS_PER_100_YEARS;
    let y4 = n / DAYS_PER_4_YEARS;
    n -= y4 * DAYS_PER_4_YEARS;
    let y1 = n / DAYS_PER_YEAR;
    if (y1 === 4n) y1 = 3n;
    if (part === DATE_PART_YEAR) {
      return Number(y400 * 400n + y100 * 100n + y4 * 4n + y1 + 1n);
    }
    n -= y1 * DAYS_PER_YEAR;
    if (part === DATE_PART_DAY_OF_YEAR) return Number(n + 1n);
    const leap = y1 === 3n && (y4 !== 24n || y100 === 3n);
    const days = leap ? DAYS_TO_MONTH_366 : DAYS_TO_MONTH_365;
    const nNum = Number(n);
    let m = (nNum >> 5) + 1;
    while (nNum >= days[m]) m++;
    if (part === DATE_PART_MONTH) return m;
    return nNum - days[m - 1] + 1;
  }

  get year() {
    return this._getDatePart(DATE_PART_YEAR);
  }
  get month() {
    return this._getDatePart(DATE_PART_MONTH);
  }
  get day() {
    return this._getDatePart(DATE_PART_DAY);
  }
  get hour() {
    return Number((this._ticks / TICKS_PER_HOUR) % 24n);
  }
  get minute() {
    return Number((this._ticks / TICKS_PER_MINUTE) % 60n);
  }
  get second() {
    return Number((this._ticks / TICKS_PER_SECOND) % 60n);
  }
  get millisecond() {
    return Number((this._ticks / TICKS_PER_MILLISECOND) % 1000n);
  }

  // Java-style getter aliases
  getYear() { return this.year; }
  getMonth() { return this.month; }
  getDay() { return this.day; }
  getHour() { return this.hour; }
  getMinute() { return this.minute; }
  getSecond() { return this.second; }

  equals(other) {
    return other instanceof NDateTime && this._ticks === other._ticks;
  }

  compareTo(other) {
    if (this._ticks < other._ticks) return -1;
    if (this._ticks > other._ticks) return 1;
    return 0;
  }

  toString() {
    const pad = (n, w = 2) => String(n).padStart(w, '0');
    return `${pad(this.year, 4)}-${pad(this.month)}-${pad(this.day)} ${pad(this.hour)}:${pad(this.minute)}:${pad(this.second)}`;
  }
}

export const MinValue = new NDateTime(MIN_TICKS);
export const MaxValue = new NDateTime(MAX_TICKS);
