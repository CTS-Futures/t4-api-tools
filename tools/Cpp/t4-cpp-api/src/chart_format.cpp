#include "t4decoder/chart_format.hpp"

#include "t4decoder/n_date_time.hpp"

namespace t4 {

long long getBarStartTime(long long timeTicks, long long tradeDateTicks,
                          ChartDataType dataType) {
  switch (dataType) {
    case ChartDataType::Second: {
      NDateTime t(timeTicks);
      return NDateTime(t.year(), t.month(), t.day(), t.hour(), t.minute(),
                       t.second(), 0)
          .ticks();
    }
    case ChartDataType::Minute:
    case ChartDataType::TPO: {
      NDateTime t(timeTicks);
      return NDateTime(t.year(), t.month(), t.day(), t.hour(), t.minute(), 0, 0)
          .ticks();
    }
    case ChartDataType::Hour: {
      NDateTime t(timeTicks);
      return NDateTime(t.year(), t.month(), t.day(), t.hour(), 0, 0, 0).ticks();
    }
    case ChartDataType::Day:
      return tradeDateTicks;
    default:
      return timeTicks;
  }
}

}  // namespace t4
