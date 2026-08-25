package com.cts.javademo.state;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;
import java.util.function.Function;
import java.util.concurrent.locks.ReentrantLock;

/**
 * Shared application state, guarded by a single lock. Background network threads
 * mutate it via {@link #write}; the Swing UI snapshots it via {@link #read} on the
 * EDT. After every write, registered listeners are notified so the UI can refresh.
 *
 * <p>Fields are public for terse access inside {@code write}/{@code read} lambdas;
 * always go through those helpers so access stays serialized.
 */
public final class AppState {

    public enum ConnStatus { DISCONNECTED, CONNECTING, CONNECTED, LOGGED_IN, ERROR }

    public static final class AccountInfo {
        public final String accountId;
        public final String displayName;

        public AccountInfo(String accountId, String displayName) {
            this.accountId = accountId;
            this.displayName = displayName;
        }

        @Override
        public String toString() {
            return displayName;
        }
    }

    /** Top-of-book quote + last trade. */
    public static final class Quote {
        public String bidPrice = "";
        public int bidVolume;
        public String askPrice = "";
        public int askVolume;
        public String lastPrice = "";
        public int lastVolume;
    }

    /** One level of the order book (bid or offer side). */
    public static final class DepthLine {
        public final String price;
        public final int volume;
        public final int numOrders;

        public DepthLine(String price, int volume, int numOrders) {
            this.price = price;
            this.volume = volume;
            this.numOrders = numOrders;
        }
    }

    /** One executed trade (drives chart fill markers and the Fills table). */
    public static final class Fill {
        public final long timeMs;
        public final String price;
        public final int volume;
        public final boolean buy;
        public final String marketId;
        public final String uniqueId;

        public Fill(long timeMs, String price, int volume, boolean buy, String marketId, String uniqueId) {
            this.timeMs = timeMs;
            this.price = price;
            this.volume = volume;
            this.buy = buy;
            this.marketId = marketId;
            this.uniqueId = uniqueId;
        }
    }

    /** One row of the positions table, keyed by market id. */
    public static final class PositionRow {
        public String marketId = "";
        public int net;
        public int workingBuys;
        public int workingSells;
        public double rpl;
        public double upl;
        public double avgOpenPrice;
    }

    /** One row of the orders table, keyed by unique id. */
    public static final class OrderRow {
        public String uniqueId = "";
        public String accountId = "";
        public String marketId = "";
        public String side = "";
        public String priceType = "";
        public int volume;
        public int workingVolume;
        public String limitPrice = "";
        public String stopPrice = "";
        public String status = "";
        public String statusDetail = "";
    }

    /** One OHLCV candle (chart tab). */
    public static final class Candle {
        public long timeMs;
        public double open;
        public double high;
        public double low;
        public double close;
        public long volume;

        public Candle() {
        }

        public Candle(long timeMs, double open, double high, double low, double close, long volume) {
            this.timeMs = timeMs;
            this.open = open;
            this.high = high;
            this.low = low;
            this.close = close;
            this.volume = volume;
        }
    }

    private final ReentrantLock lock = new ReentrantLock();
    private final List<Runnable> listeners = new ArrayList<>();

    // --- connection / session ---
    public ConnStatus connection = ConnStatus.DISCONNECTED;
    public final List<String> logLines = new ArrayList<>();

    public List<AccountInfo> accounts = new ArrayList<>();
    public String selectedAccount;
    public String authToken;
    public long tokenExpirySeconds;

    // --- active market-data product ---
    public String exchangeId;
    public String contractId;
    public String marketId;

    // --- market data ---
    public final Quote quote = new Quote();
    public int marketDecimals;
    public int marketRealDecimals;
    public String marketPointValue;
    public double marketTickSize;
    /** Full order book for the active market (best first). Guarded by {@code depthMarketId}. */
    public List<DepthLine> bids = new ArrayList<>();
    public List<DepthLine> offers = new ArrayList<>();
    /** Market the ladder belongs to (stale-guard against updates arriving after a switch). */
    public String depthMarketId;

    // --- account funds / positions / orders ---
    public double balance;
    public double margin;
    public double availableCash;
    public final Map<String, PositionRow> positions = new LinkedHashMap<>();
    public final Map<String, OrderRow> orders = new LinkedHashMap<>();

    // --- chart ---
    public List<Candle> candles = new ArrayList<>();
    public String chartInterval = "Minute";
    public int chartPeriod = 1;
    public long chartIntervalSecs = 60;
    public String chartFormat = "";
    public boolean chartLoading;
    public boolean chartLoadingOlder;
    public boolean chartNoMore;
    public java.time.LocalDate chartWindowStart;
    /** Bumped on each fresh dataset so the chart view re-locks to the latest bars. */
    public int chartGeneration;

    // --- fills (executed trades) ---
    public final List<Fill> fills = new ArrayList<>();
    /** Bumped on each new fill so overlays/tables can detect changes cheaply. */
    public int fillGeneration;

    // --- chart UI state (persists across tab switches / market switches) ---
    public boolean darkMode = true;

    /** Run a mutating action under the lock, then notify UI listeners. */
    public void write(Consumer<AppState> mutator) {
        lock.lock();
        try {
            mutator.accept(this);
        } finally {
            lock.unlock();
        }
        notifyListeners();
    }

    /** Run a read action under the lock and return its result (snapshot pattern). */
    public <T> T read(Function<AppState, T> reader) {
        lock.lock();
        try {
            return reader.apply(this);
        } finally {
            lock.unlock();
        }
    }

    /** Append a log line (capped at 1000, newest last); also echoed to stdout. */
    public void log(String message) {
        System.out.println("[t4] " + message);
        write(s -> {
            s.logLines.add(message);
            int n = s.logLines.size();
            if (n > 1000) {
                s.logLines.subList(0, n - 1000).clear();
            }
        });
    }

    /** Append an executed fill (capped at 2000, newest last) and bump {@link #fillGeneration}. */
    public void addFill(Fill fill) {
        write(s -> {
            s.fills.add(fill);
            int n = s.fills.size();
            if (n > 2000) {
                s.fills.subList(0, n - 2000).clear();
            }
            s.fillGeneration++;
        });
    }

    public void addListener(Runnable listener) {
        lock.lock();
        try {
            listeners.add(listener);
        } finally {
            lock.unlock();
        }
    }

    private void notifyListeners() {
        List<Runnable> snapshot;
        lock.lock();
        try {
            snapshot = new ArrayList<>(listeners);
        } finally {
            lock.unlock();
        }
        for (Runnable r : snapshot) {
            r.run();
        }
    }
}
