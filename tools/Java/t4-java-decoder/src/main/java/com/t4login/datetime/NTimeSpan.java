package com.t4login.datetime;

import java.util.Locale;

public class NTimeSpan {

    public static final long Int64_MaxValue = 0x7FFFFFFFFFFFFFFFL;
    public static final long Int64_MinValue = 0x8000000000000000L;

    public static final long    TicksPerMillisecond =  10000;
    private static final double MillisecondsPerTick = 1.0 / TicksPerMillisecond;

    public static final long TicksPerSecond = TicksPerMillisecond * 1000;   // 10,000,000
    private static final double SecondsPerTick =  1.0 / TicksPerSecond;         // 0.0001

    public static final long TicksPerMinute = TicksPerSecond * 60;         // 600,000,000
    private static final double MinutesPerTick = 1.0 / TicksPerMinute; // 1.6666666666667e-9

    public static final long TicksPerHour = TicksPerMinute * 60;        // 36,000,000,000
    private static final double HoursPerTick = 1.0 / TicksPerHour; // 2.77777777777777778e-11

    public static final long TicksPerDay = TicksPerHour * 24;          // 864,000,000,000
    private static final double DaysPerTick = 1.0 / TicksPerDay; // 1.1574074074074074074e-12

    private static final int MillisPerSecond = 1000;
    private static final int MillisPerMinute = MillisPerSecond * 60; //     60,000
    private static final int MillisPerHour = MillisPerMinute * 60;   //  3,600,000
    private static final int MillisPerDay = MillisPerHour * 24;      // 86,400,000

    public static final long MaxSeconds = Int64_MaxValue / TicksPerSecond;
    public static final long MinSeconds = Int64_MinValue / TicksPerSecond;

    public static final long MaxMilliSeconds = Int64_MaxValue / TicksPerMillisecond;
    public static final long MinMilliSeconds = Int64_MinValue / TicksPerMillisecond;

    public static final long TicksPerTenthSecond = TicksPerMillisecond * 100;

    public static final NTimeSpan Zero = new NTimeSpan(0);

    public static final NTimeSpan MaxValue = new NTimeSpan(Int64_MaxValue);
    public static final NTimeSpan MinValue = new NTimeSpan(Int64_MinValue);

    // public so that DateTime doesn't have to call an extra get
    // method for some arithmetic operations.
    public long _ticks;

    //public NTimeSpan() {
    //    _ticks = 0;
    //}

    public NTimeSpan(long ticks) {
        this._ticks = ticks;
    }

    public NTimeSpan(int hours, int minutes, int seconds) {
        _ticks = TimeToTicks(hours, minutes, seconds);
    }

    public NTimeSpan(int days, int hours, int minutes, int seconds)
    {
        this(days,hours,minutes,seconds,0);
    }

    public NTimeSpan(int days, int hours, int minutes, int seconds, int milliseconds)
    {
        long totalMilliSeconds = ((long)days * 3600 * 24 + (long)hours * 3600 + (long)minutes * 60 + seconds) * 1000 + milliseconds;
        if (totalMilliSeconds > MaxMilliSeconds || totalMilliSeconds < MinMilliSeconds)
            throw new IllegalArgumentException("Overflow_TimeSpanTooLong");
        _ticks =  (long)totalMilliSeconds * TicksPerMillisecond;
    }

    public long getTicks() {
        return _ticks;
    }

    public int getDays() {
         return (int)(_ticks / TicksPerDay);
    }

    public int getHours() {
         return (int)((_ticks / TicksPerHour) % 24);
    }

    public int getMilliseconds() {
        return (int)((_ticks / TicksPerMillisecond) % 1000);
    }

    public int getMinutes() {
         return (int)((_ticks / TicksPerMinute) % 60);
    }

    public int getSeconds() {
        return (int)((_ticks / TicksPerSecond) % 60);
    }

    public double getTotalDays() {
         return ((double)_ticks) * DaysPerTick;
    }

    public double getTotalHours() {
        return (double)_ticks * HoursPerTick;
    }

    public double getTotalMilliseconds() {
            double temp = (double)_ticks * MillisecondsPerTick;
            if (temp > MaxMilliSeconds)
                return (double)MaxMilliSeconds;

            if (temp < MinMilliSeconds)
                return (double)MinMilliSeconds;

            return temp;
    }

    public double getTotalMinutes() {
         return (double)_ticks * MinutesPerTick;
    }

    public double getTotalSeconds() {
         return (double)_ticks * SecondsPerTick;
    }

    public NTimeSpan Add(NTimeSpan ts) {
        long result = _ticks + ts._ticks;
        // Overflow if signs of operands was identical and result's
        // sign was opposite.
        // >> 63 gives the sign bit (either 64 1's or 64 0's).
        if ((_ticks >> 63 == ts._ticks >> 63) && (_ticks >> 63 != result >> 63))
            throw new IllegalArgumentException("Overflow_TimeSpanTooLong");
        return new NTimeSpan(result);
    }


//    // Compares two NTimeSpan values, returning an integer that indicates their
//    // relationship.
//    //
//    public static int Compare(NTimeSpan t1, NTimeSpan t2) {
//        if (t1._ticks > t2._ticks) return 1;
//        if (t1._ticks < t2._ticks) return -1;
//        return 0;
//    }
//
//    // Returns a value less than zero if this  object
//    public int CompareTo(Object value) {
//        if (value == null) return 1;
//        if (!(value is NTimeSpan))
//        throw new ArgumentException(Environment.GetResourceString("Arg_MustBeTimeSpan"));
//        long t = ((NTimeSpan)value)._ticks;
//        if (_ticks > t) return 1;
//        if (_ticks < t) return -1;
//        return 0;
//    }
//
//    #if GENERICS_WORK
//    public int CompareTo(NTimeSpan value) {
//        long t = value._ticks;
//        if (_ticks > t) return 1;
//        if (_ticks < t) return -1;
//        return 0;
//    }
//    #endif
//
//    public static NTimeSpan FromDays(double value) {
//        return Interval(value, MillisPerDay);
//    }
//
//    public NTimeSpan Duration() {
//        if (Ticks==NTimeSpan.MinValue.Ticks)
//            throw new OverflowException(Environment.GetResourceString("Overflow_Duration"));
//        Contract.EndContractBlock();
//        return new NTimeSpan(_ticks >= 0? _ticks: -_ticks);
//    }
//
//    public override bool Equals(Object value) {
//        if (value is NTimeSpan) {
//            return _ticks == ((NTimeSpan)value)._ticks;
//        }
//        return false;
//    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;

        NTimeSpan nTimeSpan = (NTimeSpan) o;

        return _ticks == nTimeSpan._ticks;

    }

    @Override
    public int hashCode() {
        return (int) (_ticks ^ (_ticks >>> 32));
    }



//    public static NTimeSpan FromHours(double value) {
//        return Interval(value, MillisPerHour);
//    }
//
//    private static NTimeSpan Interval(double value, int scale) {
//        if (Double.IsNaN(value))
//            throw new ArgumentException(Environment.GetResourceString("Arg_CannotBeNaN"));
//        Contract.EndContractBlock();
//        double tmp = value * scale;
//        double millis = tmp + (value >= 0? 0.5: -0.5);
//        if ((millis > Int64_MaxValue / TicksPerMillisecond) || (millis < Int64_MinValue / TicksPerMillisecond))
//            throw new OverflowException(Environment.GetResourceString("Overflow_TimeSpanTooLong"));
//        return new NTimeSpan((long)millis * TicksPerMillisecond);
//    }
//
//    public static NTimeSpan FromMilliseconds(double value) {
//        return Interval(value, 1);
//    }
//
//    public static NTimeSpan FromMinutes(double value) {
//        return Interval(value, MillisPerMinute);
//    }
//
//    public NTimeSpan Negate() {
//        if (Ticks==NTimeSpan.MinValue.Ticks)
//            throw new OverflowException(Environment.GetResourceString("Overflow_NegateTwosCompNum"));
//        Contract.EndContractBlock();
//        return new NTimeSpan(-_ticks);
//    }
//
//    public static NTimeSpan FromSeconds(double value) {
//        return Interval(value, MillisPerSecond);
//    }
//
//    public NTimeSpan Subtract(NTimeSpan ts) {
//        long result = _ticks - ts._ticks;
//        // Overflow if signs of operands was different and result's
//        // sign was opposite from the first argument's sign.
//        // >> 63 gives the sign bit (either 64 1's or 64 0's).
//        if ((_ticks >> 63 != ts._ticks >> 63) && (_ticks >> 63 != result >> 63))
//            throw new OverflowException(Environment.GetResourceString("Overflow_TimeSpanTooLong"));
//        return new NTimeSpan(result);
//    }
//
//    public static NTimeSpan FromTicks(long value) {
//        return new NTimeSpan(value);
//    }

    public static long TimeToTicks(int hour, int minute, int second) {
        // totalSeconds is bounded by 2^31 * 2^12 + 2^31 * 2^8 + 2^31,
        // which is less than 2^44, meaning we won't overflow totalSeconds.
        long totalSeconds = (long)hour * 3600 + (long)minute * 60 + (long)second;
        if (totalSeconds > MaxSeconds || totalSeconds < MinSeconds)
            throw new IllegalArgumentException("Overflow_TimeSpanTooLong");
        return totalSeconds * TicksPerSecond;
    }

//    // See System.Globalization.TimeSpanParse and System.Globalization.TimeSpanFormat 
//    #region ParseAndFormat
//    public static NTimeSpan Parse(String s) {
//            /* Constructs a NTimeSpan from a string.  Leading and trailing white space characters are allowed. */
//        return TimeSpanParse.Parse(s, null);
//    }
//    public static NTimeSpan Parse(String input, IFormatProvider formatProvider) {
//        return TimeSpanParse.Parse(input, formatProvider);
//    }
//    public static NTimeSpan ParseExact(String input, String format, IFormatProvider formatProvider) {
//        return TimeSpanParse.ParseExact(input, format, formatProvider, TimeSpanStyles.None);
//    }
//    public static NTimeSpan ParseExact(String input, String[] formats, IFormatProvider formatProvider) {
//        return TimeSpanParse.ParseExactMultiple(input, formats, formatProvider, TimeSpanStyles.None);
//    }
//    public static NTimeSpan ParseExact(String input, String format, IFormatProvider formatProvider, TimeSpanStyles styles) {
//        TimeSpanParse.ValidateStyles(styles, "styles");
//        return TimeSpanParse.ParseExact(input, format, formatProvider, styles);
//    }
//    public static NTimeSpan ParseExact(String input, String[] formats, IFormatProvider formatProvider, TimeSpanStyles styles) {
//        TimeSpanParse.ValidateStyles(styles, "styles");
//        return TimeSpanParse.ParseExactMultiple(input, formats, formatProvider, styles);
//    }
//    public static Boolean TryParse(String s, out NTimeSpan result) {
//        return TimeSpanParse.TryParse(s, null, out result);
//    }
//    public static Boolean TryParse(String input, IFormatProvider formatProvider, out NTimeSpan result) {
//        return TimeSpanParse.TryParse(input, formatProvider, out result);
//    }
//    public static Boolean TryParseExact(String input, String format, IFormatProvider formatProvider, out NTimeSpan result) {
//        return TimeSpanParse.TryParseExact(input, format, formatProvider, TimeSpanStyles.None, out result);
//    }
//    public static Boolean TryParseExact(String input, String[] formats, IFormatProvider formatProvider, out NTimeSpan result) {
//        return TimeSpanParse.TryParseExactMultiple(input, formats, formatProvider, TimeSpanStyles.None, out result);
//    }
//    public static Boolean TryParseExact(String input, String format, IFormatProvider formatProvider, TimeSpanStyles styles, out NTimeSpan result) {
//        TimeSpanParse.ValidateStyles(styles, "styles");
//        return TimeSpanParse.TryParseExact(input, format, formatProvider, styles, out result);
//    }
//    public static Boolean TryParseExact(String input, String[] formats, IFormatProvider formatProvider, TimeSpanStyles styles, out NTimeSpan result) {
//        TimeSpanParse.ValidateStyles(styles, "styles");
//        return TimeSpanParse.TryParseExactMultiple(input, formats, formatProvider, styles, out result);
//    }

    @Override
    public String toString() {
        return String.format(Locale.US,"%02d:%02d:%02d", getHours(), getMinutes(), getSeconds());
    }


//    public override String ToString() {
//        return TimeSpanFormat.Format(this, null, null);
//    }
//    public String ToString(String format) {
//        return TimeSpanFormat.Format(this, format, null);
//    }
//    public String ToString(String format, IFormatProvider formatProvider) {
//        if (LegacyMode) {
//            return TimeSpanFormat.Format(this, null, null);
//        }
//        else {
//            return TimeSpanFormat.Format(this, format, formatProvider);
//        }
//    }
//    #endregion
//
//    public static NTimeSpan operator -(NTimeSpan t) {
//        if (t._ticks==NTimeSpan.MinValue._ticks)
//            throw new OverflowException(Environment.GetResourceString("Overflow_NegateTwosCompNum"));
//        return new NTimeSpan(-t._ticks);
//    }
//
//    public static NTimeSpan operator -(NTimeSpan t1, NTimeSpan t2) {
//        return t1.Subtract(t2);
//    }
//
//    public static NTimeSpan operator +(NTimeSpan t) {
//        return t;
//    }
//
//    public static NTimeSpan operator +(NTimeSpan t1, NTimeSpan t2) {
//        return t1.Add(t2);
//    }
//
//    public static bool operator ==(NTimeSpan t1, NTimeSpan t2) {
//        return t1._ticks == t2._ticks;
//    }
//
//    public static bool operator !=(NTimeSpan t1, NTimeSpan t2) {
//        return t1._ticks != t2._ticks;
//    }
//
//    public static bool operator <(NTimeSpan t1, NTimeSpan t2) {
//        return t1._ticks < t2._ticks;
//    }
//
//    public static bool operator <=(NTimeSpan t1, NTimeSpan t2) {
//        return t1._ticks <= t2._ticks;
//    }
//
//    public static bool operator >(NTimeSpan t1, NTimeSpan t2) {
//        return t1._ticks > t2._ticks;
//    }
//
//    public static bool operator >=(NTimeSpan t1, NTimeSpan t2) {
//        return t1._ticks >= t2._ticks;
//    }
//
//
//    //
//    // In .NET Framework v1.0 - v3.5 System.NTimeSpan did not implement IFormattable
//    //    The composite formatter ignores format specifiers on types that do not implement
//    //    IFormattable, so the following code would 'just work' by using NTimeSpan.ToString()
//    //    under the hood:
//    //        String.Format("{0:_someRandomFormatString_}", myTimeSpan);      
//    //    
//    // In .NET Framework v4.0 System.NTimeSpan implements IFormattable.  This causes the 
//    //    composite formatter to call NTimeSpan.ToString(string format, FormatProvider provider)
//    //    and pass in "_someRandomFormatString_" for the format parameter.  When the format 
//    //    parameter is invalid a FormatException is thrown.
//    //
//    // The 'NetFx40_TimeSpanLegacyFormatMode' per-AppDomain configuration option and the 'TimeSpan_LegacyFormatMode' 
//    // process-wide configuration option allows applications to run with the v1.0 - v3.5 legacy behavior.  When
//    // either switch is specified the format parameter is ignored and the default output is returned.
//    //
//    // There are three ways to use the process-wide configuration option:
//    //
//    // 1) Config file (MyApp.exe.config)
//    //        <?xml version ="1.0"?>
//    //        <configuration>
//    //         <runtime>
//    //          <TimeSpan_LegacyFormatMode enabled="true"/>
//    //         </runtime>
//    //        </configuration>
//    // 2) Environment variable
//    //        set COMPLUS_TimeSpan_LegacyFormatMode=1
//    // 3) RegistryKey
//    //        [HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\.NETFramework]
//    //        "TimeSpan_LegacyFormatMode"=dword:00000001
//    //
//    #if !FEATURE_CORECLR
//    [System.Security.SecurityCritical]
//            [ResourceExposure(ResourceScope.None)]
//            [MethodImplAttribute(MethodImplOptions.InternalCall)]
//    private static extern bool LegacyFormatMode();
//    #endif // !FEATURE_CORECLR
//    //
//    // In Silverlight v4, specifying the APP_EARLIER_THAN_SL4.0 quirks mode allows applications to
//    // run in v2 - v3 legacy behavior.
//    //
//    #if !FEATURE_CORECLR
//    [System.Security.SecuritySafeCritical]
//            #endif
//    private static bool GetLegacyFormatMode() {
//        #if !FEATURE_CORECLR
//        if (LegacyFormatMode()) // FCALL to check COMPLUS_TimeSpan_LegacyFormatMode
//            return true;
//        return CompatibilitySwitches.IsNetFx40TimeSpanLegacyFormatMode;
//        #else
//        return CompatibilitySwitches.IsAppEarlierThanSilverlight4;
//        #endif // !FEATURE_CORECLR
//    }
//
//    private static volatile bool _legacyConfigChecked;
//    private static volatile bool _legacyMode;
//
//    private static bool LegacyMode {
//        get {
//            if (!_legacyConfigChecked) {
//                // no need to lock - idempotent
//                _legacyMode = GetLegacyFormatMode();
//                _legacyConfigChecked = true;
//            }
//            return _legacyMode;
//        }
//    }

    public static NTimeSpan fromMilliseconds(long millis) {
        return new NTimeSpan(millis * TicksPerMillisecond);
    }


    public static NTimeSpan fromString(String timeSpanString) {

        if (timeSpanString.length() == 0) {
            return new NTimeSpan(0,0,0);
        }

        String[] parts = timeSpanString.split(":");

        if (parts.length == 3) {
            int hours = Integer.parseInt(parts[0]);
            int minutes = Integer.parseInt(parts[1]);
            int seconds = Integer.parseInt(parts[2]);
            return new NTimeSpan(hours, minutes, seconds);
        }

        if (parts.length == 2) {
            int minutes = Integer.parseInt(parts[0]);
            int seconds = Integer.parseInt(parts[1]);
            return new NTimeSpan(0, minutes, seconds);
        }

        if (parts.length == 1) {
            long ticks = Long.parseLong(parts[0]);
            return new NTimeSpan(ticks);
        }

        return NTimeSpan.Zero;
    }
}
