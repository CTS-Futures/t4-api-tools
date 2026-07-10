#include "t4decoder/n_date_time.hpp"

#include <array>
#include <cstdio>
#include <stdexcept>

namespace t4 {

namespace {
constexpr long long kDaysPerYear = 365;
constexpr long long kDaysPer4Years = kDaysPerYear * 4 + 1;       // 1461
constexpr long long kDaysPer100Years = kDaysPer4Years * 25 - 1;  // 36524
constexpr long long kDaysPer400Years = kDaysPer100Years * 4 + 1; // 146097

const std::array<int, 13> kDaysToMonth365 = {
    0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334, 365};
const std::array<int, 13> kDaysToMonth366 = {
    0, 31, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335, 366};

bool isLeapYear(int year) {
  return year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
}

long long dateToTicks(int year, int month, int day) {
  if (year >= 1 && year <= 9999 && month >= 1 && month <= 12) {
    const auto& days = isLeapYear(year) ? kDaysToMonth366 : kDaysToMonth365;
    if (day >= 1 && day <= days[month] - days[month - 1]) {
      long long y = year - 1;
      long long n = y * 365 + y / 4 - y / 100 + y / 400 + days[month - 1] +
                    day - 1;
      return n * NDateTime::kTicksPerDay;
    }
  }
  throw std::out_of_range("NDateTime: invalid date");
}

long long timeToTicks(int hour, int minute, int second) {
  if (hour >= 0 && hour < 24 && minute >= 0 && minute < 60 && second >= 0 &&
      second < 60) {
    return static_cast<long long>(hour) * NDateTime::kTicksPerHour +
           static_cast<long long>(minute) * NDateTime::kTicksPerMinute +
           static_cast<long long>(second) * NDateTime::kTicksPerSecond;
  }
  throw std::out_of_range("NDateTime: invalid time");
}
}  // namespace

NDateTime::NDateTime(int year, int month, int day, int hour, int minute,
                     int second, int millisecond)
    : ticks_(dateToTicks(year, month, day) + timeToTicks(hour, minute, second) +
             static_cast<long long>(millisecond) * kTicksPerMillisecond) {}

int NDateTime::datePart(int part) const {
  long long n = ticks_ / kTicksPerDay;
  long long y400 = n / kDaysPer400Years;
  n -= y400 * kDaysPer400Years;
  long long y100 = n / kDaysPer100Years;
  if (y100 == 4) y100 = 3;
  n -= y100 * kDaysPer100Years;
  long long y4 = n / kDaysPer4Years;
  n -= y4 * kDaysPer4Years;
  long long y1 = n / kDaysPerYear;
  if (y1 == 4) y1 = 3;
  if (part == kPartYear)
    return static_cast<int>(y400 * 400 + y100 * 100 + y4 * 4 + y1 + 1);
  n -= y1 * kDaysPerYear;
  if (part == kPartDayOfYear) return static_cast<int>(n + 1);
  bool leap = (y1 == 3) && (y4 != 24 || y100 == 3);
  const auto& days = leap ? kDaysToMonth366 : kDaysToMonth365;
  int nNum = static_cast<int>(n);
  int m = (nNum >> 5) + 1;
  while (nNum >= days[m]) ++m;
  if (part == kPartMonth) return m;
  return nNum - days[m - 1] + 1;
}

std::string NDateTime::toString() const {
  char buf[32];
  std::snprintf(buf, sizeof(buf), "%04d-%02d-%02d %02d:%02d:%02d", year(),
                month(), day(), hour(), minute(), second());
  return std::string(buf);
}

}  // namespace t4
