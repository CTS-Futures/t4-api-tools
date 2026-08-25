// Port of com.t4login.datetime.NDateTime (JS: datetime/NDateTime.js).
//
// .NET-style DateTime: tick = 100 ns since 0001-01-01 00:00:00. Tick values
// for real chart data (~6.4e17) fit comfortably in int64, so unlike the JS
// port (which needs BigInt) this uses plain long long. Only the decode subset
// is ported (tick storage + calendar breakdown for getBarStartTime / CSV).
#pragma once

#include <cstdint>
#include <string>

namespace t4 {

class NDateTime {
public:
  static constexpr long long kTicksPerMillisecond = 10000LL;
  static constexpr long long kTicksPerSecond = kTicksPerMillisecond * 1000;
  static constexpr long long kTicksPerMinute = kTicksPerSecond * 60;
  static constexpr long long kTicksPerHour = kTicksPerMinute * 60;
  static constexpr long long kTicksPerDay = kTicksPerHour * 24;

  NDateTime() : ticks_(0) {}
  explicit NDateTime(long long ticks) : ticks_(ticks) {}
  NDateTime(int year, int month, int day, int hour = 0, int minute = 0,
            int second = 0, int millisecond = 0);

  long long ticks() const { return ticks_; }

  int year() const { return datePart(kPartYear); }
  int month() const { return datePart(kPartMonth); }
  int day() const { return datePart(kPartDay); }
  int hour() const { return static_cast<int>((ticks_ / kTicksPerHour) % 24); }
  int minute() const { return static_cast<int>((ticks_ / kTicksPerMinute) % 60); }
  int second() const { return static_cast<int>((ticks_ / kTicksPerSecond) % 60); }
  int millisecond() const {
    return static_cast<int>((ticks_ / kTicksPerMillisecond) % 1000);
  }

  int compareTo(const NDateTime& o) const {
    return ticks_ < o.ticks_ ? -1 : (ticks_ > o.ticks_ ? 1 : 0);
  }
  bool equals(const NDateTime& o) const { return ticks_ == o.ticks_; }

  // "YYYY-MM-DD HH:MM:SS"
  std::string toString() const;

private:
  static constexpr int kPartYear = 0;
  static constexpr int kPartDayOfYear = 1;
  static constexpr int kPartMonth = 2;
  static constexpr int kPartDay = 3;
  int datePart(int part) const;

  long long ticks_;
};

}  // namespace t4
