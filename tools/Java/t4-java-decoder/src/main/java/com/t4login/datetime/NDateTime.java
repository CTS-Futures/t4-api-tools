package com.t4login.datetime;

import com.t4login.Log;

import java.io.IOException;
import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.time.ZonedDateTime;
import java.util.Calendar;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

/**
 * Date time representation that follows the .Net implementation.
 */
public class NDateTime implements Comparable<NDateTime> {

    private static final String TAG = "NDateTime";

    // Number of 100ns ticks per time unit
    private static final long TicksPerMillisecond = 10000;
    private static final long TicksPerSecond = TicksPerMillisecond * 1000;
    private static final long TicksPerMinute = TicksPerSecond * 60;
    private static final long TicksPerHour = TicksPerMinute * 60;
    private static final long TicksPerDay = TicksPerHour * 24;

    // Number of milliseconds per time unit
    public static final int MillisPerSecond = 1000;
    public static final int MillisPerMinute = MillisPerSecond * 60;
    public static final int MillisPerHour = MillisPerMinute * 60;
    public static final int MillisPerDay = MillisPerHour * 24;

    // Number of days in a non-leap year
    private static final int DaysPerYear = 365;
    // Number of days in 4 years
    private static final int DaysPer4Years = DaysPerYear * 4 + 1;       // 1461
    // Number of days in 100 years
    private static final int DaysPer100Years = DaysPer4Years * 25 - 1;  // 36524
    // Number of days in 400 years
    private static final int DaysPer400Years = DaysPer100Years * 4 + 1; // 146097

    // Number of days from 1/1/0001 to 12/31/1600
    private static final int DaysTo1601 = DaysPer400Years * 4;          // 584388
    // Number of days from 1/1/0001 to 12/30/1899
    private static final int DaysTo1899 = DaysPer400Years * 4 + DaysPer100Years * 3 - 367;
    // Number of days from 1/1/0001 to 12/31/1969
    public static final int DaysTo1970 = DaysPer400Years * 4 + DaysPer100Years * 3 + DaysPer4Years * 17 + DaysPerYear; // 719,162
    // Number of days from 1/1/0001 to 12/31/9999
    private static final int DaysTo10000 = DaysPer400Years * 25 - 366;  // 3652059

    public static final long MinTicks = 0;
    public static final long MaxTicks = DaysTo10000 * TicksPerDay - 1;
    private static final long MaxMillis = (long) DaysTo10000 * MillisPerDay;

    private static final long FileTimeOffset = DaysTo1601 * TicksPerDay;
    private static final long DoubleDateOffset = DaysTo1899 * TicksPerDay;
    // The minimum OA date is 0100/01/01 (Note it's year 100).
    // The maximum OA date is 9999/12/31
    private static final long OADateMinAsTicks = (DaysPer100Years - DaysPerYear) * TicksPerDay;
    // All OA dates must be greater than (not >=) OADateMinAsDouble
    private static final double OADateMinAsDouble = -657435.0;
    // All OA dates must be less than (not <=) OADateMaxAsDouble
    private static final double OADateMaxAsDouble = 2958466.0;

    private static final int DatePartYear = 0;
    private static final int DatePartDayOfYear = 1;
    private static final int DatePartMonth = 2;
    private static final int DatePartDay = 3;

    private static final int[] DaysToMonth365 = {
            0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334, 365};
    private static final int[] DaysToMonth366 = {
            0, 31, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335, 366};


    public static final NDateTime MinValue = new NDateTime(MinTicks, DateTimeKind.Unspecified);
    public static final NDateTime MaxValue = new NDateTime(MaxTicks, DateTimeKind.Unspecified);
    public static final NDateTime Epoch = new NDateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc);

    private static final long TicksMask = 0x3FFFFFFFFFFFFFFFL;
    private static final long FlagsMask = 0xC000000000000000L;
    private static final long LocalMask = 0x8000000000000000L;
    private static final long TicksCeiling = 0x4000000000000000L;
    private static final long KindUnspecified = 0x0000000000000000L;
    private static final long KindUtc = 0x4000000000000000L;
    private static final long KindLocal = 0x8000000000000000L;
    private static final long KindLocalAmbiguousDst = 0xC000000000000000L;
    private static final long KindShift = 62;

//    private final String TicksField = "ticks";
//    private final String DateDataField = "dateData";

    // The data is stored as an unsigned 64-bit integer
    //   Bits 01-62: The value of 100-nanosecond ticks where 0 represents 1/1/0001 12:00am, up until the value
    //               12/31/9999 23:59:59.9999999
    //   Bits 63-64: A four-state value that describes the DateTimeKind value of the date time, with a 2nd
    //               value for the rare case where the date time is local, but is in an overlapped daylight
    //               savings time hour and it is in daylight savings time. This allows distinction of these
    //               otherwise ambiguous local times and prevents data loss when round tripping from Local to
    //               UTC time.
    private long dateData;


    /**
     * Constructs a NDateTime from a tick count. The ticks argument specifies
     * the date as the number of 100-nanosecond intervals that have elapsed since 1/1/0001 12:00am.
     *
     * @param ticks
     */
    public NDateTime(long ticks) {
        if (ticks < MinTicks || ticks > MaxTicks)
            throw new IllegalArgumentException("ArgumentOutOfRange_DateTimeBadTicks");
        dateData = ticks;
    }

    /**
     * Constructs a copy of an existing NDateTime.
     *
     * @param dt
     */
    public NDateTime(NDateTime dt) {
        dateData = dt.dateData;
    }

    public NDateTime(long ticks, DateTimeKind kind) {
        if (ticks < MinTicks || ticks > MaxTicks) {
            throw new IllegalArgumentException("ArgumentOutOfRange_DateTimeBadTicks");
        }

        this.dateData = (ticks | ((long) kind.getValue() << KindShift));
    }


    // Constructs a NDateTime from a given year, month, and day. The
    // time-of-day of the resulting NDateTime is always midnight.
    //
    public NDateTime(int year, int month, int day) {
        this.dateData = DateToTicks(year, month, day);
    }


    // Constructs a NDateTime from a given year, month, day, hour,
    // minute, and second.
    //
    public NDateTime(int year, int month, int day, int hour, int minute, int second) {
        this.dateData = DateToTicks(year, month, day) + TimeToTicks(hour, minute, second);
    }

    public NDateTime(int year, int month, int day, int hour, int minute, int second, DateTimeKind kind) {
        long ticks = DateToTicks(year, month, day) + TimeToTicks(hour, minute, second);
        this.dateData = (ticks | ((long) kind.getValue() << KindShift));
    }

    // Constructs a NDateTime from a given year, month, day, hour,
    // minute, and second.
    //
    public NDateTime(int year, int month, int day, int hour, int minute, int second, int millisecond) {
        if (millisecond < 0 || millisecond >= MillisPerSecond) {
            throw new IllegalArgumentException("ArgumentOutOfRange_Range : millisecond");
        }

        long ticks = DateToTicks(year, month, day) + TimeToTicks(hour, minute, second);
        ticks += millisecond * TicksPerMillisecond;
        if (ticks < MinTicks || ticks > MaxTicks)
            throw new IllegalArgumentException("Arg_DateTimeRange");
        this.dateData = ticks;
    }

    public NDateTime(int year, int month, int day, int hour, int minute, int second, int millisecond, DateTimeKind kind) {
        if (millisecond < 0 || millisecond >= MillisPerSecond) {
            throw new IllegalArgumentException("ArgumentOutOfRange_Range : millisecond");
        }

        long ticks = DateToTicks(year, month, day) + TimeToTicks(hour, minute, second);
        ticks += millisecond * TicksPerMillisecond;
        if (ticks < MinTicks || ticks > MaxTicks)
            throw new IllegalArgumentException("Arg_DateTimeRange");
        this.dateData = (ticks | ((long) kind.getValue() << KindShift));
    }


    private long getInternalTicks() {
        return (dateData & TicksMask);
    }

    private long getInternalKind() {
        return (dateData & FlagsMask);
    }

    public void set(long ticks) {
        this.dateData = ticks;
    }

    /**
     * Returns the NDateTime resulting from adding the given NTimeSpan to this NDateTime.
     *
     * @param value The time span to add.
     * @return
     */
    public NDateTime Add(NTimeSpan value) {
        return AddTicks(value._ticks);
    }

    public void increment(NTimeSpan value) {
        incrementTicks(value._ticks);
    }

    // Returns the NDateTime resulting from adding a fractional number of
    // time units to this NDateTime.
    private NDateTime Add(double value, int scale) {
        long millis = (long) (value * scale + (value >= 0 ? 0.5 : -0.5));
        if (millis <= -MaxMillis || millis >= MaxMillis)
            throw new IllegalArgumentException("ArgumentOutOfRange_AddValue");
        return AddTicks(millis * TicksPerMillisecond);
    }

    private void increment(double value, int scale) {
        long millis = (long) (value * scale + (value >= 0 ? 0.5 : -0.5));
        if (millis <= -MaxMillis || millis >= MaxMillis)
            throw new IllegalArgumentException("ArgumentOutOfRange_AddValue");
        incrementTicks(millis * TicksPerMillisecond);
    }

    // Returns the NDateTime resulting from adding a fractional number of
    // days to this NDateTime. The result is computed by rounding the
    // fractional number of days given by value to the nearest
    // millisecond, and adding that interval to this NDateTime. The
    // value argument is permitted to be negative.
    //
    public NDateTime AddDays(double value) {
        return Add(value, MillisPerDay);
    }

    public void incrementDays(double value) {
        increment(value, MillisPerDay);
    }

    // Returns the NDateTime resulting from adding a fractional number of
    // hours to this NDateTime. The result is computed by rounding the
    // fractional number of hours given by value to the nearest
    // millisecond, and adding that interval to this NDateTime. The
    // value argument is permitted to be negative.
    //
    public NDateTime AddHours(double value) {
        return Add(value, MillisPerHour);
    }

    public void incrementHours(double value) {
        increment(value, MillisPerHour);
    }

    // Returns the NDateTime resulting from the given number of
    // milliseconds to this NDateTime. The result is computed by rounding
    // the number of milliseconds given by value to the nearest integer,
    // and adding that interval to this NDateTime. The value
    // argument is permitted to be negative.
    //
    public NDateTime AddMilliseconds(double value) {
        return Add(value, 1);
    }

    public void incrementMilliseconds(double value) {
        increment(value, 1);
    }

    // Returns the NDateTime resulting from adding a fractional number of
    // minutes to this NDateTime. The result is computed by rounding the
    // fractional number of minutes given by value to the nearest
    // millisecond, and adding that interval to this NDateTime. The
    // value argument is permitted to be negative.
    //
    public NDateTime AddMinutes(double value) {
        return Add(value, MillisPerMinute);
    }

    public void incrementMinutes(double value) {
        increment(value, MillisPerMinute);
    }

    // Returns the NDateTime resulting from adding the given number of
    // months to this NDateTime. The result is computed by incrementing
    // (or decrementing) the year and month parts of this NDateTime by
    // months months, and, if required, adjusting the day part of the
    // resulting date downwards to the last day of the resulting month in the
    // resulting year. The time-of-day part of the result is the same as the
    // time-of-day part of this NDateTime.
    //
    // In more precise terms, considering this NDateTime to be of the
    // form y / m / d + t, where y is the
    // year, m is the month, d is the day, and t is the
    // time-of-day, the result is y1 / m1 / d1 + t,
    // where y1 and m1 are computed by adding months months
    // to y and m, and d1 is the largest value less than
    // or equal to d that denotes a valid day in month m1 of year
    // y1.
    //
    public NDateTime AddMonths(int months) {
        if (months < -120000 || months > 120000)
            throw new IllegalArgumentException("ArgumentOutOfRange_DateTimeBadMonths");

        int y = GetDatePart(DatePartYear);
        int m = GetDatePart(DatePartMonth);
        int d = GetDatePart(DatePartDay);
        int i = m - 1 + months;
        if (i >= 0) {
            m = i % 12 + 1;
            y = y + i / 12;
        } else {
            m = 12 + (i + 1) % 12;
            y = y + (i - 11) / 12;
        }
        if (y < 1 || y > 9999) {
            throw new IllegalArgumentException("ArgumentOutOfRange_DateArithmetic");
        }

        int days = DaysInMonth(y, m);
        if (d > days) d = days;

        return new NDateTime((DateToTicks(y, m, d) + getInternalTicks() % TicksPerDay) | getInternalKind());
    }

    public void incrementMonths(int months) {
        if (months < -120000 || months > 120000)
            throw new IllegalArgumentException("ArgumentOutOfRange_DateTimeBadMonths");

        int y = GetDatePart(DatePartYear);
        int m = GetDatePart(DatePartMonth);
        int d = GetDatePart(DatePartDay);
        int i = m - 1 + months;
        if (i >= 0) {
            m = i % 12 + 1;
            y = y + i / 12;
        } else {
            m = 12 + (i + 1) % 12;
            y = y + (i - 11) / 12;
        }
        if (y < 1 || y > 9999) {
            throw new IllegalArgumentException("ArgumentOutOfRange_DateArithmetic");
        }

        int days = DaysInMonth(y, m);
        if (d > days) d = days;

        this.dateData = (DateToTicks(y, m, d) + getInternalTicks() % TicksPerDay) | getInternalKind();
    }

    // Returns the NDateTime resulting from adding a fractional number of
    // seconds to this NDateTime. The result is computed by rounding the
    // fractional number of seconds given by value to the nearest
    // millisecond, and adding that interval to this NDateTime. The
    // value argument is permitted to be negative.
    //
    public NDateTime AddSeconds(double value) {
        return Add(value, MillisPerSecond);
    }

    public void incrementSeconds(double value) {
        increment(value, MillisPerSecond);
    }

    // Returns the NDateTime resulting from adding the given number of
    // 100-nanosecond ticks to this NDateTime. The value argument
    // is permitted to be negative.
    //
    public NDateTime AddTicks(long value) {
        long ticks = getInternalTicks();
        if (value > MaxTicks - ticks || value < MinTicks - ticks) {
            throw new IllegalArgumentException("ArgumentOutOfRange_DateArithmetic");
        }
        return new NDateTime((ticks + value) , getKind());
    }

    /**
     * Increments this value by the specified number of ticks.
     * <p/>
     * Caution: Modifies this value, USE WITH CAUTION.
     *
     * @param value The number of ticks to increment this value by.
     */
    public void incrementTicks(long value) {
        long ticks = getInternalTicks();
        if (value > MaxTicks - ticks || value < MinTicks - ticks) {
            throw new IllegalArgumentException("ArgumentOutOfRange_DateArithmetic");
        }
        this.dateData = ((ticks + value) | getInternalKind());
    }

    // Returns the NDateTime resulting from adding the given number of
    // years to this NDateTime. The result is computed by incrementing
    // (or decrementing) the year part of this NDateTime by value
    // years. If the month and day of this NDateTime is 2/29, and if the
    // resulting year is not a leap year, the month and day of the resulting
    // NDateTime becomes 2/28. Otherwise, the month, day, and time-of-day
    // parts of the result are the same as those of this NDateTime.
    //
    public NDateTime AddYears(int value) {
        if (value < -10000 || value > 10000)
            throw new IllegalArgumentException("ArgumentOutOfRange_DateTimeBadYears");

        return AddMonths(value * 12);
    }

    public void incrementYears(int value) {
        if (value < -10000 || value > 10000)
            throw new IllegalArgumentException("ArgumentOutOfRange_DateTimeBadYears");

        incrementMonths(value * 12);
    }

    public boolean isBefore(NDateTime other) {
        return this.compareTo(other) < 0;
    }

    public boolean isAfter(NDateTime other) {
        return this.compareTo(other) > 0;
    }

    @Override
    public int compareTo(NDateTime another) {
        long valueTicks = another.getInternalTicks();
        long ticks = getInternalTicks();
        if (ticks > valueTicks) return 1;
        if (ticks < valueTicks) return -1;
        return 0;
    }

    // Returns the tick count corresponding to the given year, month, and day.
    // Will check the if the parameters are valid.
    private static long DateToTicks(int year, int month, int day) {
        if (year >= 1 && year <= 9999 && month >= 1 && month <= 12) {
            int[] days = IsLeapYear(year) ? DaysToMonth366 : DaysToMonth365;
            if (day >= 1 && day <= days[month] - days[month - 1]) {
                int y = year - 1;
                int n = y * 365 + y / 4 - y / 100 + y / 400 + days[month - 1] + day - 1;
                return n * TicksPerDay;
            }
        }
        throw new IllegalArgumentException("ArgumentOutOfRange_BadYearMonthDay");
    }

    // Return the tick count corresponding to the given hour, minute, second.
    // Will check the if the parameters are valid.
    private static long TimeToTicks(int hour, int minute, int second) {
        //NTimeSpan.TimeToTicks is a family access function which does no error checking, so
        //we need to put some error checking out here.
        if (hour >= 0 && hour < 24 && minute >= 0 && minute < 60 && second >= 0 && second < 60) {
            return (NTimeSpan.TimeToTicks(hour, minute, second));
        }
        throw new IllegalArgumentException("ArgumentOutOfRange_BadHourMinuteSecond");
    }

    // Returns the number of days in the month given by the year and
    // month arguments.
    //
    public static int DaysInMonth(int year, int month) {
        if (month < 1 || month > 12)
            throw new IllegalArgumentException("ArgumentOutOfRange_Month");

        // IsLeapYear checks the year argument
        int[] days = IsLeapYear(year) ? DaysToMonth366 : DaysToMonth365;
        return days[month] - days[month - 1];
    }

//    // Converts an OLE Date to a tick count.
//    // This function is duplicated in COMDateTime.cpp
//    internal static long DoubleDateToTicks(double value) {
//        // The check done this way will take care of NaN
//        if (!(value < OADateMaxAsDouble) || !(value > OADateMinAsDouble))
//            throw new ArgumentException(Environment.GetResourceString("Arg_OleAutDateInvalid"));
//
//        // Conversion to long will not cause an overflow here, as at this point the "value" is in between OADateMinAsDouble and OADateMaxAsDouble
//        long millis = (long)(value * MillisPerDay + (value >= 0? 0.5: -0.5));
//        // The interesting thing here is when you have a value like 12.5 it all positive 12 days and 12 hours from 01/01/1899
//        // However if you a value of -12.25 it is minus 12 days but still positive 6 hours, almost as though you meant -11.75 all negative
//        // This line below fixes up the millis in the negative case
//        if (millis < 0) {
//            millis -= (millis % MillisPerDay) * 2;
//        }
//
//        millis += DoubleDateOffset / TicksPerMillisecond;
//
//        if (millis < 0 || millis >= MaxMillis) throw new ArgumentException(Environment.GetResourceString("Arg_OleAutDateScale"));
//        return millis * TicksPerMillisecond;
//    }
//
//    #if !FEATURE_CORECLR
//    [DllImport(JitHelpers.QCall, CharSet = CharSet.Unicode)]
//            [SecurityCritical]
//            [ResourceExposure(ResourceScope.None)]
//            [SuppressUnmanagedCodeSecurity]
//            [return: MarshalAs(UnmanagedType.Bool)]
//    internal static extern bool LegacyParseMode();
//
//    [DllImport(JitHelpers.QCall, CharSet = CharSet.Unicode)]
//            [SecurityCritical]
//            [ResourceExposure(ResourceScope.None)]
//            [SuppressUnmanagedCodeSecurity]
//            [return: MarshalAs(UnmanagedType.Bool)]
//    internal static extern bool EnableAmPmParseAdjustment();
//    #endif

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;

        if (!(o instanceof NDateTime)) {
            return false;
        }

        NDateTime otherDateTime = (NDateTime) o;
        long ticks = getInternalTicks();
        long otherTicks = otherDateTime.getInternalTicks();

        return ticks == otherTicks;
    }

    @Override
    public int hashCode() {
        return (int) (dateData ^ (dateData >>> 32));
    }


//    // Checks if this NDateTime is equal to a given object. Returns
//    // true if the given object is a boxed NDateTime and its value
//    // is equal to the value of this NDateTime. Returns false
//    // otherwise.
//    //
//    public override bool Equals(Object value) {
//        if (value is NDateTime) {
//            return InternalTicks == ((NDateTime)value).InternalTicks;
//        }
//        return false;
//    }
//
//    public bool Equals(NDateTime value) {
//        return InternalTicks == value.InternalTicks;
//    }
//
//    // Compares two NDateTime values for equality. Returns true if
//    // the two NDateTime values are equal, or false if they are
//    // not equal.
//    //
//    public static bool Equals(NDateTime t1, NDateTime t2) {
//        return t1.InternalTicks == t2.InternalTicks;
//    }
//
//    public static NDateTime FromBinary(Int64 dateData) {
//        if ((dateData & (unchecked( (Int64) LocalMask))) != 0) {
//            // Local times need to be adjusted as you move from one time zone to another,
//            // just as they are when serializing in text. As such the format for local times
//            // changes to store the ticks of the UTC time, but with flags that look like a
//            // local date.
//            Int64 ticks = dateData & (unchecked((Int64)TicksMask));
//            // Negative ticks are stored in the top part of the range and should be converted back into a negative number
//            if (ticks > TicksCeiling - TicksPerDay) {
//                ticks = ticks - TicksCeiling;
//            }
//            // Convert the ticks back to local. If the UTC ticks are out of range, we need to default to
//            // the UTC offset from MinValue and MaxValue to be consistent with Parse.
//            Boolean isAmbiguousLocalDst = false;
//            Int64 offsetTicks;
//            if (ticks < MinTicks) {
//                offsetTicks = TimeZoneInfo.GetLocalUtcOffset(NDateTime.MinValue, TimeZoneInfoOptions.NoThrowOnInvalidTime).Ticks;
//            }
//            else if (ticks > MaxTicks) {
//                offsetTicks = TimeZoneInfo.GetLocalUtcOffset(NDateTime.MaxValue, TimeZoneInfoOptions.NoThrowOnInvalidTime).Ticks;
//            }
//            else {
//                // Because the ticks conversion between UTC and local is lossy, we need to capture whether the
//                // time is in a repeated hour so that it can be passed to the NDateTime constructor.
//                NDateTime utcDt = new NDateTime(ticks, DateTimeKind.Utc);
//                Boolean isDaylightSavings = false;
//                offsetTicks = TimeZoneInfo.GetUtcOffsetFromUtc(utcDt, TimeZoneInfo.Local, out isDaylightSavings, out isAmbiguousLocalDst).Ticks;
//            }
//            ticks += offsetTicks;
//            // Another behaviour of parsing is to cause small times to wrap around, so that they can be used
//            // to compare times of day
//            if (ticks < 0) {
//                ticks += TicksPerDay;
//            }
//            if (ticks < MinTicks || ticks > MaxTicks) {
//                throw new ArgumentException(Environment.GetResourceString("Argument_DateTimeBadBinaryData"), "dateData");
//            }
//            return new NDateTime(ticks, DateTimeKind.Local, isAmbiguousLocalDst);
//        }
//        else {
//            return NDateTime.FromBinaryRaw(dateData);
//        }
//    }
//
//    // A version of ToBinary that uses the real representation and does not adjust local times. This is needed for
//    // scenarios where the serialized data must maintain compatability
//    internal static NDateTime FromBinaryRaw(Int64 dateData) {
//        Int64 ticks = dateData & (Int64)TicksMask;
//        if (ticks < MinTicks || ticks > MaxTicks)
//            throw new ArgumentException(Environment.GetResourceString("Argument_DateTimeBadBinaryData"), "dateData");
//        return new NDateTime((UInt64)dateData);
//    }
//
//    // Creates a NDateTime from a Windows filetime. A Windows filetime is
//    // a long representing the date and time as the number of
//    // 100-nanosecond intervals that have elapsed since 1/1/1601 12:00am.
//    //
//    public static NDateTime FromFileTime(long fileTime) {
//        return FromFileTimeUtc(fileTime).ToLocalTime();
//    }
//
//    public static NDateTime FromFileTimeUtc(long fileTime) {
//        if (fileTime < 0 || fileTime > MaxTicks - FileTimeOffset) {
//            throw new ArgumentOutOfRangeException("fileTime", Environment.GetResourceString("ArgumentOutOfRange_FileTimeInvalid"));
//        }
//        Contract.EndContractBlock();
//
//        // This is the ticks in Universal time for this fileTime.
//        long universalTicks = fileTime + FileTimeOffset;
//        return new NDateTime(universalTicks, DateTimeKind.Utc);
//    }
//
//    // Creates a NDateTime from an OLE Automation Date.
//    //
//    public static NDateTime FromOADate(double d) {
//        return new NDateTime(DoubleDateToTicks(d), DateTimeKind.Unspecified);
//    }
//
//    #if FEATURE_SERIALIZATION
//    [System.Security.SecurityCritical /*auto-generated_required*/]
//    void ISerializable.GetObjectData(SerializationInfo info, StreamingContext context) {
//        if (info==null) {
//            throw new ArgumentNullException("info");
//        }
//        Contract.EndContractBlock();
//
//        // Serialize both the old and the new format
//        info.AddValue(TicksField, InternalTicks);
//        info.AddValue(DateDataField, dateData);
//    }
//    #endif
//
//    public Boolean IsDaylightSavingTime() {
//        if (Kind == DateTimeKind.Utc) {
//            return false;
//        }
//        return TimeZoneInfo.Local.IsDaylightSavingTime(this, TimeZoneInfoOptions.NoThrowOnInvalidTime);
//    }
//
//    public static NDateTime SpecifyKind(NDateTime value, DateTimeKind kind) {
//        return new NDateTime(value.InternalTicks, kind);
//    }
//
//    public Int64 ToBinary() {
//        if (Kind == DateTimeKind.Local) {
//            // Local times need to be adjusted as you move from one time zone to another,
//            // just as they are when serializing in text. As such the format for local times
//            // changes to store the ticks of the UTC time, but with flags that look like a
//            // local date.
//
//            // To match serialization in text we need to be able to handle cases where
//            // the UTC value would be out of range. Unused parts of the ticks range are
//            // used for this, so that values just past max value are stored just past the
//            // end of the maximum range, and values just below minimum value are stored
//            // at the end of the ticks area, just below 2^62.
//            NTimeSpan offset = TimeZoneInfo.GetLocalUtcOffset(this, TimeZoneInfoOptions.NoThrowOnInvalidTime);
//            Int64 ticks = Ticks;
//            Int64 storedTicks = ticks - offset.Ticks;
//            if (storedTicks < 0) {
//                storedTicks = TicksCeiling + storedTicks;
//            }
//            return storedTicks | (unchecked((Int64) LocalMask));
//        }
//        else {
//            return (Int64)dateData;
//        }
//    }
//
//    // Return the underlying data, without adjust local times to the right time zone. Needed if performance
//    // or compatability are important.
//    internal Int64 ToBinaryRaw() {
//        return (Int64)dateData;
//    }

    /**
     * Returns the date part of this NDateTime.
     *
     * @return This NDateTime with the time-of-day part set to zero (midnight).
     */
    public NDateTime getDate() {
        long ticks = getInternalTicks();
        return new NDateTime((ticks - ticks % TicksPerDay) | getInternalKind());
    }

    // Returns a given date part of this NDateTime. This method is used
    // to compute the year, day-of-year, month, or day part.
    private int GetDatePart(int part) {
        long ticks = getInternalTicks();
        // n = number of days since 1/1/0001
        int n = (int) (ticks / TicksPerDay);
        // y400 = number of whole 400-year periods since 1/1/0001
        int y400 = n / DaysPer400Years;
        // n = day number within 400-year period
        n -= y400 * DaysPer400Years;
        // y100 = number of whole 100-year periods within 400-year period
        int y100 = n / DaysPer100Years;
        // Last 100-year period has an extra day, so decrement result if 4
        if (y100 == 4) y100 = 3;
        // n = day number within 100-year period
        n -= y100 * DaysPer100Years;
        // y4 = number of whole 4-year periods within 100-year period
        int y4 = n / DaysPer4Years;
        // n = day number within 4-year period
        n -= y4 * DaysPer4Years;
        // y1 = number of whole years within 4-year period
        int y1 = n / DaysPerYear;
        // Last year has an extra day, so decrement result if 4
        if (y1 == 4) y1 = 3;
        // If year was requested, compute and return it
        if (part == DatePartYear) {
            return y400 * 400 + y100 * 100 + y4 * 4 + y1 + 1;
        }
        // n = day number within year
        n -= y1 * DaysPerYear;
        // If day-of-year was requested, return it
        if (part == DatePartDayOfYear) return n + 1;
        // Leap year calculation looks different from IsLeapYear since y1, y4,
        // and y100 are relative to year 1, not year 0
        boolean leapYear = y1 == 3 && (y4 != 24 || y100 == 3);
        int[] days = leapYear ? DaysToMonth366 : DaysToMonth365;
        // All months have less than 32 days, so n >> 5 is a good conservative
        // estimate for the month
        int m = n >> 5 + 1;
        // m = 1-based month number
        while (n >= days[m]) m++;
        // If month was requested, return it
        if (part == DatePartMonth) return m;
        // Return 1-based day-of-month
        return n - days[m - 1] + 1;
    }

    // Returns the day-of-month part of this NDateTime. The returned
    // value is an integer between 1 and 31.
    //
    public int getDay() {
        return GetDatePart(DatePartDay);
    }

    // Returns the day-of-week part of this NDateTime. The returned value
    // is an integer between 0 and 6, where 0 indicates Sunday, 1 indicates
    // Monday, 2 indicates Tuesday, 3 indicates Wednesday, 4 indicates
    // Thursday, 5 indicates Friday, and 6 indicates Saturday.
    //
    public DayOfWeek getDayOfWeek() {
        return DayOfWeek.get((int) ((getInternalTicks() / TicksPerDay + 1) % 7));
    }

    // Returns the day-of-year part of this NDateTime. The returned value
    // is an integer between 1 and 366.
    //
    public int getDayOfYear() {
        return GetDatePart(DatePartDayOfYear);
    }

//    // Returns the hash code for this NDateTime.
//    //
//    public override int GetHashCode() {
//        Int64 ticks = InternalTicks;
//        return unchecked((int)ticks) ^ (int)(ticks >> 32);
//    }

    // Returns the hour part of this NDateTime. The returned value is an
    // integer between 0 and 23.
    //
    public int getHour() {
        return (int) ((getInternalTicks() / TicksPerHour) % 24);
    }

//    internal Boolean IsAmbiguousDaylightSavingTime() {
//        return (InternalKind == KindLocalAmbiguousDst);
//    }
//
//    [Pure]
//    public DateTimeKind Kind {
//        get {
//            switch (InternalKind) {
//                case KindUnspecified:
//                    return DateTimeKind.Unspecified;
//                case KindUtc:
//                    return DateTimeKind.Utc;
//                default:
//                    return DateTimeKind.Local;
//            }
//        }
//    }

    public DateTimeKind getKind() {

        long intKind = getInternalKind();

        if (intKind == KindUnspecified) {
            return DateTimeKind.Unspecified;
        } else if (intKind == KindUtc) {
            return DateTimeKind.Utc;
        }else{
            return DateTimeKind.Local;
        }
    }

    // Returns the millisecond part of this NDateTime. The returned value
    // is an integer between 0 and 999.
    //
    public int getMillisecond() {
        return (int) ((getInternalTicks() / TicksPerMillisecond) % 1000);
    }

    // Returns the minute part of this NDateTime. The returned value is
    // an integer between 0 and 59.
    //
    public int getMinute() {
        return (int) ((getInternalTicks() / TicksPerMinute) % 60);
    }

    // Returns the month part of this NDateTime. The returned value is an
    // integer between 1 and 12.
    //
    public int getMonth() {
        return GetDatePart(DatePartMonth);
    }

    /**
     * Returns a NDateTime representing the current date and time.
     */
    public static NDateTime now() {
        TimeZone tz = TimeZone.getTimeZone("America/Chicago");
        Calendar c = Calendar.getInstance(tz, Locale.US);

        int year = c.get(Calendar.YEAR);
        int month = c.get(Calendar.MONTH) + 1;
        int day = c.get(Calendar.DAY_OF_MONTH);
        int hour = c.get(Calendar.HOUR_OF_DAY);
        int minute = c.get(Calendar.MINUTE);
        int second = c.get(Calendar.SECOND);
        int ms = c.get(Calendar.MILLISECOND);

        return new NDateTime(year, month, day, hour, minute, second, ms);
    }

    public static NDateTime utcNow() {
        long ctMs = System.currentTimeMillis();
        return Epoch.AddMilliseconds((double)ctMs);
    }

//    public static NDateTime UtcNow {
//        [System.Security.SecuritySafeCritical]  // auto-generated
//        get {
//            Contract.Ensures(Contract.Result<NDateTime>().Kind == DateTimeKind.Utc);
//            // following code is tuned for speed. Don't change it without running benchmark.
//            long ticks = 0;
//            ticks = GetSystemTimeAsFileTime();
//
//            #if FEATURE_LEGACYNETCF
//            // Windows Phone 7.0/7.1 return the ticks up to millisecond, not up to the 100th nanosecond.
//            if (CompatibilitySwitches.IsAppEarlierThanWindowsPhone8)
//            {
//                long ticksms = ticks / TicksPerMillisecond;
//                ticks = ticksms * TicksPerMillisecond;
//            }
//            #endif
//            return new NDateTime( ((UInt64)(ticks + FileTimeOffset)) | KindUtc);
//        }
//    }
//
//
//    [System.Security.SecurityCritical]  // auto-generated
//            [MethodImplAttribute(MethodImplOptions.InternalCall)]
//    internal static extern long GetSystemTimeAsFileTime();
//
//

    // Returns the second part of this NDateTime. The returned value is
    // an integer between 0 and 59.
    //
    public int getSecond() {
        return (int) ((getInternalTicks() / TicksPerSecond) % 60);
    }

    // Returns the tick count for this NDateTime. The returned value is
    // the number of 100-nanosecond intervals that have elapsed since 1/1/0001
    // 12:00am.
    //
    public long getTicks() {
        return getInternalTicks();
    }

    // Returns the time-of-day part of this NDateTime. The returned value
    // is a NTimeSpan that indicates the time elapsed since midnight.
    //
    public NTimeSpan getTimeOfDay() {
        return new NTimeSpan(getInternalTicks() % TicksPerDay);
    }

    public static SimpleDateFormat createDateFormat(String format) {

        SimpleDateFormat fmt = new SimpleDateFormat(format, Locale.US);
        fmt.setTimeZone(TimeZone.getTimeZone("America/Chicago"));
        return fmt;
    }

    // Returns a NDateTime representing the current date. The date part
    // of the returned value is the current date, and the time-of-day part of
    // the returned value is zero (midnight).
    //
    public static NDateTime today() {
        return NDateTime.now().getDate();
    }

    // Returns the year part of this NDateTime. The returned value is an
    // integer between 1 and 9999.
    //
    public int getYear() {
        return GetDatePart(DatePartYear);
    }

    // Checks whether a given year is a leap year. This method returns true if
    // year is a leap year, or false if not.
    //
    public static boolean IsLeapYear(int year) {
        if (year < 1 || year > 9999) {
            throw new IllegalArgumentException("ArgumentOutOfRange_Year");
        }

        return year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    }

//    // Constructs a NDateTime from a string. The string must specify a
//    // date and optionally a time in a culture-specific or universal format.
//    // Leading and trailing whitespace characters are allowed.
//    //
//    public static NDateTime Parse(String s) {
//        return (DateTimeParse.Parse(s, DateTimeFormatInfo.CurrentInfo, DateTimeStyles.None));
//    }
//
//    // Constructs a NDateTime from a string. The string must specify a
//    // date and optionally a time in a culture-specific or universal format.
//    // Leading and trailing whitespace characters are allowed.
//    //
//    public static NDateTime Parse(String s, IFormatProvider provider) {
//        return (DateTimeParse.Parse(s, DateTimeFormatInfo.GetInstance(provider), DateTimeStyles.None));
//    }
//
//    public static NDateTime Parse(String s, IFormatProvider provider, DateTimeStyles styles) {
//        DateTimeFormatInfo.ValidateStyles(styles, "styles");
//        return (DateTimeParse.Parse(s, DateTimeFormatInfo.GetInstance(provider), styles));
//    }
//
//    // Constructs a NDateTime from a string. The string must specify a
//    // date and optionally a time in a culture-specific or universal format.
//    // Leading and trailing whitespace characters are allowed.
//    //
//    public static NDateTime ParseExact(String s, String format, IFormatProvider provider) {
//        return (DateTimeParse.ParseExact(s, format, DateTimeFormatInfo.GetInstance(provider), DateTimeStyles.None));
//    }
//
//    // Constructs a NDateTime from a string. The string must specify a
//    // date and optionally a time in a culture-specific or universal format.
//    // Leading and trailing whitespace characters are allowed.
//    //
//    public static NDateTime ParseExact(String s, String format, IFormatProvider provider, DateTimeStyles style) {
//        DateTimeFormatInfo.ValidateStyles(style, "style");
//        return (DateTimeParse.ParseExact(s, format, DateTimeFormatInfo.GetInstance(provider), style));
//    }
//
//    public static NDateTime ParseExact(String s, String[] formats, IFormatProvider provider, DateTimeStyles style) {
//        DateTimeFormatInfo.ValidateStyles(style, "style");
//        return DateTimeParse.ParseExactMultiple(s, formats, DateTimeFormatInfo.GetInstance(provider), style);
//    }

    public NTimeSpan Subtract(NDateTime value) {
        return new NTimeSpan(getInternalTicks() - value.getInternalTicks());
    }

    public NDateTime Subtract(NTimeSpan value) {
        long ticks = getInternalTicks();
        long valueTicks = value._ticks;
        if (ticks - MinTicks < valueTicks || ticks - MaxTicks > valueTicks) {
            throw new IllegalArgumentException("ArgumentOutOfRange_DateArithmetic");
        }
        return new NDateTime((ticks - valueTicks) | getInternalKind());
    }

    public void decrement(NTimeSpan value) {
        long ticks = getInternalTicks();
        long valueTicks = value._ticks;
        if (ticks - MinTicks < valueTicks || ticks - MaxTicks > valueTicks) {
            throw new IllegalArgumentException("ArgumentOutOfRange_DateArithmetic");
        }

        this.dateData = (ticks - valueTicks) | getInternalKind();
    }

//    // This function is duplicated in COMDateTime.cpp
//    private static double TicksToOADate(long value) {
//        if (value == 0)
//            return 0.0;  // Returns OleAut's zero'ed date value.
//        if (value < TicksPerDay) // This is a fix for VB. They want the default day to be 1/1/0001 rathar then 12/30/1899.
//            value += DoubleDateOffset; // We could have moved this fix down but we would like to keep the bounds check.
//        if (value < OADateMinAsTicks)
//            throw new OverflowException(Environment.GetResourceString("Arg_OleAutDateInvalid"));
//        // Currently, our max date == OA's max date (12/31/9999), so we don't
//        // need an overflow check in that direction.
//        long millis = (value  - DoubleDateOffset) / TicksPerMillisecond;
//        if (millis < 0) {
//            long frac = millis % MillisPerDay;
//            if (frac != 0) millis -= (MillisPerDay + frac) * 2;
//        }
//        return (double)millis / MillisPerDay;
//    }
//
//    // Converts the NDateTime instance into an OLE Automation compatible
//    // double date.
//    public double ToOADate() {
//        return TicksToOADate(InternalTicks);
//    }
//
//    public long ToFileTime() {
//        // Treats the input as local if it is not specified
//        return ToUniversalTime().ToFileTimeUtc();
//    }
//
//    public long ToFileTimeUtc() {
//        // Treats the input as universal if it is not specified
//        long ticks = ((InternalKind & LocalMask) != 0) ? ToUniversalTime().InternalTicks : this.InternalTicks;
//        ticks -= FileTimeOffset;
//        if (ticks < 0) {
//            throw new ArgumentOutOfRangeException(null, Environment.GetResourceString("ArgumentOutOfRange_FileTimeInvalid"));
//        }
//        return ticks;
//    }
//
//    public NDateTime ToLocalTime()
//    {
//        return ToLocalTime(false);
//    }
//
//    internal NDateTime ToLocalTime(bool throwOnOverflow)
//    {
//        if (Kind == DateTimeKind.Local) {
//            return this;
//        }
//        Boolean isDaylightSavings = false;
//        Boolean isAmbiguousLocalDst = false;
//        Int64 offset = TimeZoneInfo.GetUtcOffsetFromUtc(this, TimeZoneInfo.Local, out isDaylightSavings, out isAmbiguousLocalDst).Ticks;
//        long tick = Ticks + offset;
//        if (tick > NDateTime.MaxTicks)
//        {
//            if (throwOnOverflow)
//                throw new ArgumentException(Environment.GetResourceString("Arg_ArgumentOutOfRangeException"));
//            else
//                return new NDateTime(NDateTime.MaxTicks, DateTimeKind.Local);
//        }
//        if (tick < NDateTime.MinTicks)
//        {
//            if (throwOnOverflow)
//                throw new ArgumentException(Environment.GetResourceString("Arg_ArgumentOutOfRangeException"));
//            else
//                return new NDateTime(NDateTime.MinTicks, DateTimeKind.Local);
//        }
//        return new NDateTime(tick, DateTimeKind.Local, isAmbiguousLocalDst);
//    }
//
//    public String ToLongDateString() {
//        Contract.Ensures(Contract.Result<String>() != null);
//        return DateTimeFormat.Format(this, "D", DateTimeFormatInfo.CurrentInfo);
//    }
//
//    public String ToLongTimeString() {
//        Contract.Ensures(Contract.Result<String>() != null);
//        return DateTimeFormat.Format(this, "T", DateTimeFormatInfo.CurrentInfo);
//    }
//
//    public String ToShortDateString() {
//        Contract.Ensures(Contract.Result<String>() != null);
//        return DateTimeFormat.Format(this, "d", DateTimeFormatInfo.CurrentInfo);
//    }
//
//    public String ToShortTimeString() {
//        Contract.Ensures(Contract.Result<String>() != null);
//        return DateTimeFormat.Format(this, "t", DateTimeFormatInfo.CurrentInfo);
//    }

    @Override
    public String toString() {
        return String.format("%04d-%02d-%02d %02d:%02d:%02d.%03d", getYear(), getMonth(), getDay(), getHour(), getMinute(), getSecond(), getMillisecond());
    }

    public String toString(SimpleDateFormat fmtr) {
        TimeZone tz = TimeZone.getTimeZone("America/Chicago");
        Calendar c = Calendar.getInstance(tz, Locale.US);
        c.set(Calendar.YEAR, this.getYear());
        c.set(Calendar.MONTH, this.getMonth() -1);
        c.set(Calendar.DAY_OF_MONTH, this.getDay());
        c.set(Calendar.HOUR_OF_DAY, this.getHour());
        c.set(Calendar.MINUTE, this.getMinute());
        c.set(Calendar.SECOND, this.getSecond());
        c.set(Calendar.MILLISECOND, this.getMillisecond());

        return fmtr.format(c.getTime());
    }

    public String toString(String fmt) {
        SimpleDateFormat dateFormat = createDateFormat(fmt);
        return toString(dateFormat);
    }

    /**
     * Returns the data formatted as YYYY-MM-DD.
     *
     * @return
     */
    public String toDateString() {
        return String.format("%04d-%02d-%02d", getYear(), getMonth(), getDay());
    }

    public static NDateTime fromDateString(String s) {
        String[] parts = s.split("-");

        if (parts.length < 3) {
            throw new IllegalArgumentException("String '" + s + "' not in format 'YYYY-MM-DD'.");
        }

        int year = Integer.parseInt(parts[0]);
        int month = Integer.parseInt(parts[1]);
        int day = Integer.parseInt(parts[2]);

        return new NDateTime(year, month, day);
    }

    public static NDateTime fromyyyyMMdd(String s) {

        if (s.length() !=8) {
            throw new IllegalArgumentException("String '" + s + "' not in format 'yyyyMMdd'.");
        }

        int year = Integer.parseInt(s.substring(0,4));
        int month = Integer.parseInt(s.substring(4,6));
        int day = Integer.parseInt(s.substring(6,8));

        return new NDateTime(year, month, day);
    }

    public String toShortTimeString() {
        return String.format("%02d:%02d", getHour(), getMinute());
    }

    public String toTimeString() {
        return String.format("%02d:%02d:%02d", getHour(), getMinute(), getSecond());
    }

    public String toLongtTimeString() {
        return String.format("%02d:%02d:%02d.%03d", getHour(), getMinute(), getSecond(), getMillisecond());
    }

    public static NDateTime fromTimeString(NDateTime date, String s) {
        String[] parts = s.split(":");

        if (parts.length < 2) {
            throw new IllegalArgumentException("String '" + s + "' not in format 'HH:MM:SS.fff'.");
        }

        int hour = Integer.parseInt(parts[0]);
        int minute = Integer.parseInt(parts[1]);
        int second = 0;
        int millisecond = 0;

        if (parts.length >= 3) {
            String[] secparts = parts[2].split("\\.");

            if (secparts.length >= 1) {
                second = Integer.parseInt(secparts[0]);

                if (secparts.length >= 2) {
                    millisecond = Integer.parseInt(secparts[1]);
                }
            }
        }


        return new NDateTime(date.getYear(), date.getMonth(), date.getDay(), hour, minute, second, millisecond);
    }

    public String toDateTimeString() {
        return String.format("%04d-%02d-%02d %02d:%02d:%02d", getYear(), getMonth(), getDay(), getHour(), getMinute(), getSecond());
    }

    public static NDateTime fromDateTimeString(String s) {
        String[] parts = s.split(" ");

        if (parts.length < 2) {
            throw new IllegalArgumentException("String '" + s + "' not in format 'YYYY-MM-DD HH:MM:SS.fff'.");
        }

        NDateTime date = fromDateString(parts[0]);
        NDateTime dateTime = fromTimeString(date, parts[1]);

        return dateTime;
    }

    public static NDateTime fromUnixTimeStamp(long epochSeconds) {
        long ticks = epochMSToTicks(epochSeconds * 1000);
        return new NDateTime(ticks, DateTimeKind.Utc);
    }


    public static NDateTime from(String formattedTime, SimpleDateFormat format) {

        TimeZone tz = TimeZone.getTimeZone("America/Chicago");
        Calendar c = Calendar.getInstance(tz, Locale.US);
        Date date = null;

        try {
            date = format.parse(formattedTime);
            c.setTime(date);
        } catch (ParseException e) {
            Log.e(TAG, "Error parsing time '" + formattedTime + "' with format '" + format + "'");
            return NDateTime.MinValue;
        }

        int year = c.get(Calendar.YEAR);
        int month = c.get(Calendar.MONTH) + 1;
        int day = c.get(Calendar.DAY_OF_MONTH);
        int hour = c.get(Calendar.HOUR_OF_DAY);
        int minute = c.get(Calendar.MINUTE);
        int second = c.get(Calendar.SECOND);
        int ms = c.get(Calendar.MILLISECOND);

        NDateTime cTime =  new NDateTime(year, month, day, hour, minute, second, ms);
        return cTime;
    }

    /**
     * Returns the current date/time as a java.util.Date
     *
     * @return The current date/time as a java.util.Date
     */
    public Date toJavaDate() {
        return new Date(toEpochMS());
    }

    /**
     * Returns the current date/time in epoch milliseconds.
     *
     * @return The current date/time in epoch milliseconds.
     */
    public long toEpochMS() {

        long millis = getInternalTicks() / 10000 - 62135596800000L;

        if (getKind() == DateTimeKind.Utc) {
            return millis;
        }

        TimeZone timeZone = TimeZone.getTimeZone("America/Chicago");
        return millis - timeZone.getOffset(millis);
    }

    /**
     * Get epoch time from a .net Tick
     *
     * @param ticks .Net DateTime.Ticks value.
     * @return Java epoch time.
     * @throws IOException
     */
    public static long ticksToEpochMS(long ticks) {
        return (ticks - 621355968000000000L) / 10000;
    }

    /**
     * Gets .Net ticks time from Java epoch time.
     *
     * @param epochms The Java epoch time.
     * @return >net ticks time.
     */
    public static long epochMSToTicks(long epochms) {
        return 621355968000000000L + (epochms * 10000);
    }

    /**
     * Returns a NDateTime instance created from epoch milliseconds.
     *
     * @param epochms The epoch ms.
     * @return A NDateTime equivalent value.
     */
    public static NDateTime fromEpochMS(long epochms) {
        return new NDateTime(epochMSToTicks(epochms));
    }
}
