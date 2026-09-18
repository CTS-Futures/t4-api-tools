using System.Runtime.InteropServices;

namespace T4APIDemo.T4.Util;

/// <summary>
/// Utility class for handling timestamps with nanosecond precision.
/// </summary>
public static class TimeUtil
{
    private static readonly TimeZoneInfo CSTZone =
        TimeZoneInfo.FindSystemTimeZoneById(
            RuntimeInformation.IsOSPlatform(OSPlatform.Windows)
                ? "Central Standard Time"
                : "America/Chicago");

    /// <summary>
    /// Converts a Google Protobuf Timestamp to DateTime in CST
    /// </summary>
    public static DateTime ProtobufTimestampToCST(this Google.Protobuf.WellKnownTypes.Timestamp timestamp)
    {
        var utcDateTime = DateTimeOffset.FromUnixTimeSeconds(timestamp.Seconds)
            .AddTicks(timestamp.Nanos / 100)
            .UtcDateTime;

        return TimeZoneInfo.ConvertTimeFromUtc(utcDateTime, CSTZone);
    }

    /// <summary>
    /// Converts a DateTime to Google Protobuf Timestamp in CST timezone
    /// </summary>
    public static Google.Protobuf.WellKnownTypes.Timestamp CSTToProtobufTimestamp(DateTime timestamp)
    {
        // Create a DateTimeOffset using the CST timezone
        var cstOffset = new DateTimeOffset(
            timestamp.Kind == DateTimeKind.Unspecified
                ? DateTime.SpecifyKind(timestamp, DateTimeKind.Unspecified)
                : timestamp,
            CSTZone.GetUtcOffset(timestamp));

        // Convert to UTC
        var utcTime = cstOffset.ToUniversalTime();

        return new Google.Protobuf.WellKnownTypes.Timestamp
        {
            Seconds = utcTime.ToUnixTimeSeconds(),
            Nanos = (int)(utcTime.Ticks % TimeSpan.TicksPerSecond) * 100
        };
    }
}