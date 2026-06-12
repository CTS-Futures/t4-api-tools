/**
 * Port of `com.t4login.definitions.chartdata.ChartDataType`.
 *
 * Preserves the Java `@AsEnum` runtime-extensible pattern: unknown values
 * passed to `get()` are dynamically registered (so the readers never
 * crash on a new aggregation type the format version may introduce).
 */

const _map = new Map();
const _values = [];

export class ChartDataType {
  /**
   * @param {number} value
   * @param {string} name
   */
  constructor(value, name) {
    this._value = value;
    this._name = name;
  }

  get value() { return this._value; }
  get name() { return this._name; }
  getValue() { return this._value; }

  /**
   * @param {number} value
   * @returns {ChartDataType}
   */
  static get(value) {
    let v = _map.get(value);
    if (v === undefined) {
      // Mirrors Java behaviour: register on the fly.
      v = new ChartDataType(value, String(value));
      _map.set(value, v);
      _values.push(v);
    }
    return v;
  }

  /** @returns {ChartDataType[]} */
  static values() {
    return [..._values];
  }

  equals(other) {
    return other instanceof ChartDataType && this._value === other._value;
  }

  toString() { return this._name; }
}

function _register(value, name) {
  const inst = new ChartDataType(value, name);
  _map.set(value, inst);
  _values.push(inst);
  return inst;
}

// --- Well-known instances (mirrors Java static block) ----------------------
export const Tick = _register(0, 'Tick');
export const Second = _register(1, 'Second');
export const Minute = _register(2, 'Minute');
export const Hour = _register(3, 'Hour');
export const Day = _register(4, 'Day');
export const TPO = _register(5, 'TPO');
export const TickChange = _register(6, 'TickChange');
