package com.t4login;

/**
 * Logging util.
 */
@SuppressWarnings("unused")
public class Log {

    public static interface Logger {

        /**
         * Returns whether the application is in debug mode or not.
         *
         * @return True if the application is compiled for debug or running under the debugger.
         */
        boolean debugMode();

        void e(String tag, String msg);

        void e(String tag, String msg, Throwable tr);

        void w(String tag, String msg);

        void w(String tag, String msg, Throwable tr);

        void d(String tag, String msg);

        void d(String tag, String msg, Throwable tr);

        void v(String tag, String msg);

        void v(String tag, String msg, Throwable tr);
    }

    public static class ConsoleLogger implements Logger {

        private final boolean _debugMode;

        public ConsoleLogger(boolean debugMode) {
            _debugMode = debugMode;
        }

        @Override
        public boolean debugMode() {
            return _debugMode;
        }

        @Override
        public void e(String tag, String msg) {
            System.out.println("e [" + tag + "]: " + msg);
        }

        @Override
        public void e(String tag, String msg, Throwable tr) {
            System.out.println("e [" + tag + "]: " + msg + "; Error:" + tr);
        }

        @Override
        public void w(String tag, String msg) {
            System.out.println("w [" + tag + "]: " + msg);
        }

        @Override
        public void w(String tag, String msg, Throwable tr) {
            System.out.println("w [" + tag + "]: " + msg + "; Error:" + tr);
        }

        @Override
        public void d(String tag, String msg) {
            System.out.println("d [" + tag + "]: " + msg);
        }

        @Override
        public void d(String tag, String msg, Throwable tr) {
            System.out.println("d [" + tag + "]: " + msg + "; Error:" + tr);
        }

        @Override
        public void v(String tag, String msg) {
            System.out.println("v [" + tag + "]: " + msg);
        }

        @Override
        public void v(String tag, String msg, Throwable tr) {
            System.out.println("v [" + tag + "]: " + msg + "; Error:" + tr);
        }
    }

    public static Logger logger = new ConsoleLogger(false);

    public enum LogLevel {
        Verbose(0, "Verbose"),
        Debug(1, "Debug"),
        Warning(2, "Warning"),
        Error(3, "Error"),
        Silent(4, "None");

        private final int _value;
        private final String _name;

        LogLevel(int value, String name) {
            _value = value;
            _name = name;
        }

        public boolean isAtLeast(LogLevel level) {
            return level._value >= _value;
        }

        @Override
        public String toString() {
            return _name;
        }
    }

    private static LogLevel _level = LogLevel.Error;

    private Log() {
    }

    public static void setLogLevel(LogLevel level) {
        _level = level;
        logger.d("Log", String.format("setLogLevel(), Log level set to %s", _level));
    }

    public static boolean debugMode() {
        if(logger != null) {
            return logger.debugMode();
        }

        return false;
    }

    public static void e(String tag, String msg) {
        if (logger != null && _level.isAtLeast(LogLevel.Error)) {
            logger.e(tag, msg);
        }
    }

    public static void e(String tag, String format, Object... args) {
        if (logger != null && _level.isAtLeast(LogLevel.Error)) {
            String msg = String.format(format, args);
            logger.e(tag, msg);
        }
    }

    public static void e(String tag, String msg, Throwable tr) {
        if (logger != null && _level.isAtLeast(LogLevel.Error)) {
            logger.e(tag, msg, tr);
        }
    }

    public static void w(String tag, String msg) {
        if (logger != null && _level.isAtLeast(LogLevel.Warning)) {
            logger.w(tag, msg);
        }
    }

    public static void w(String tag, String format, Object... args) {
        if (logger != null && _level.isAtLeast(LogLevel.Warning)) {
            String msg = String.format(format, args);
            logger.w(tag, msg);
        }
    }

    public static void w(String tag, String msg, Throwable tr) {
        if (logger != null && _level.isAtLeast(LogLevel.Warning)) {
            logger.w(tag, msg, tr);
        }
    }

    public static void d(String tag, String msg) {
        if (logger != null && _level.isAtLeast(LogLevel.Debug)) {
            logger.d(tag, msg);
        }
    }

    public static void d(String tag, String format, Object... args) {
        if (logger != null && _level.isAtLeast(LogLevel.Debug)) {
            String msg = String.format(format, args);
            logger.d(tag, msg);
        }
    }

    public static void d(String tag, String msg, Throwable tr) {
        if (logger != null && _level.isAtLeast(LogLevel.Debug)) {
            logger.d(tag, msg, tr);
        }
    }

    public static void v(String tag, String msg) {
        if (logger != null && _level.isAtLeast(LogLevel.Verbose)) {
            logger.v(tag, msg);
        }
    }

    public static void v(String tag, String format, Object... args) {
        if (logger != null && _level.isAtLeast(LogLevel.Verbose)) {
            String msg = String.format(format, args);
            logger.v(tag, msg);
        }
    }

    public static void v(String tag, String msg, Throwable tr) {
        if (logger != null && _level.isAtLeast(LogLevel.Verbose)) {
            logger.v(tag, msg, tr);
        }
    }
}
