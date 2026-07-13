package com.cts.javademo.net;

import com.cts.javademo.state.AppState.Candle;
import com.cts.t4decoder.T4BinPayload;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import com.t4login.definitions.MarketMode;
import com.t4login.datetime.NDateTime;
import com.t4login.definitions.chartdata.ChartDataStreamReaderAggr;
import com.t4login.definitions.chartdata.ChartFormatAggr;
import com.t4login.definitions.priceconversion.Price;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * REST calls against the T4 gateway: resolve markets, drive the contract picker,
 * and fetch + decode chart bars. Ported from {@code tools/Rust/RustDemo/src/net/rest.rs}.
 * Chart bars come back as the hand-rolled T4BinAggr binary, decoded with the reused
 * {@code t4-java-decoder} (no re-implementation).
 */
public final class RestClient {

    /** .NET epoch (0001-01-01) in 100ns ticks; subtract to reach the Unix epoch. */
    private static final long DOTNET_UNIX_EPOCH_TICKS = 621_355_968_000_000_000L;
    /** Oldest trade date we page back to before declaring "start of history". */
    private static final LocalDate HISTORY_FLOOR = LocalDate.of(1990, 1, 1);
    private static final DateTimeFormatter YMD = DateTimeFormatter.ofPattern("yyyy-MM-dd");

    private final String apiBase;
    private final HttpClient http = HttpClient.newHttpClient();

    public RestClient(String apiBase) {
        this.apiBase = trimTrailingSlash(apiBase);
    }

    // --- picker DTOs ---
    public record ContractHit(String exchangeId, String contractId, String description) {
    }

    public record ExchangeInfo(String exchangeId, String description) {
    }

    public record ExpiryGroup(String strategyType, String expiryDate, int marketCount) {
    }

    public record ExpiryMarket(String marketId, String expiryDate, String description) {
    }

    /** Outcome of paging back for older bars. */
    public record OlderPage(List<Candle> candles, LocalDate windowStart, boolean reachedFloor) {
    }

    // -----------------------------------------------------------------------
    // Market / picker
    // -----------------------------------------------------------------------

    /** Resolve exchange/contract to a concrete market id via the picker. */
    public String firstMarket(String token, String exchangeId, String contractId) throws IOException, InterruptedException {
        JsonObject body = getJson(token, "/markets/picker/firstmarket",
                Map.of("exchangeid", exchangeId, "contractid", contractId)).getAsJsonObject();
        String marketId = firstStr(body, "marketID", "marketId", "market_id");
        if (marketId.isEmpty()) {
            throw new IOException("firstmarket response missing marketID: " + body);
        }
        return marketId;
    }

    /** List all exchanges, sorted by description. */
    public List<ExchangeInfo> loadExchanges(String token) throws IOException, InterruptedException {
        JsonArray arr = getJson(token, "/markets/exchanges", Map.of()).getAsJsonArray();
        List<ExchangeInfo> out = new ArrayList<>();
        for (JsonElement e : arr) {
            JsonObject o = e.getAsJsonObject();
            String id = firstStr(o, "exchangeId", "exchangeID", "exchange_id");
            if (!id.isEmpty()) {
                out.add(new ExchangeInfo(id, firstStr(o, "description", "Description")));
            }
        }
        out.sort((a, b) -> a.description().compareToIgnoreCase(b.description()));
        return out;
    }

    /** List contracts under an exchange. */
    public List<ContractHit> loadContracts(String token, String exchangeId) throws IOException, InterruptedException {
        JsonArray arr = getJson(token, "/markets/contracts", Map.of("exchangeid", exchangeId)).getAsJsonArray();
        List<ContractHit> out = new ArrayList<>();
        for (JsonElement e : arr) {
            JsonObject o = e.getAsJsonObject();
            String contractId = firstStr(o, "contractID", "contractId", "contract_id");
            if (!contractId.isEmpty()) {
                String ex = firstStr(o, "exchangeID", "exchangeId", "exchange_id");
                out.add(new ContractHit(ex.isEmpty() ? exchangeId : ex, contractId,
                        firstStr(o, "description", "Description")));
            }
        }
        return out;
    }

    /** Free-text contract search. */
    public List<ContractHit> searchContracts(String token, String term) throws IOException, InterruptedException {
        JsonArray arr = getJson(token, "/markets/contracts/search",
                Map.of("search", term.toLowerCase())).getAsJsonArray();
        List<ContractHit> out = new ArrayList<>();
        for (JsonElement e : arr) {
            JsonObject o = e.getAsJsonObject();
            String ex = firstStr(o, "exchangeID", "exchangeId", "exchange_id");
            String contractId = firstStr(o, "contractID", "contractId", "contract_id");
            if (!ex.isEmpty() && !contractId.isEmpty()) {
                out.add(new ContractHit(ex, contractId, firstStr(o, "description", "Description")));
            }
        }
        return out;
    }

    /** Expiry groups for a contract. */
    public List<ExpiryGroup> loadExpiryGroups(String token, String exchangeId, String contractId)
            throws IOException, InterruptedException {
        JsonArray arr = getJson(token, "/markets/picker/groups",
                Map.of("exchangeid", exchangeId, "contractid", contractId)).getAsJsonArray();
        List<ExpiryGroup> out = new ArrayList<>();
        for (JsonElement e : arr) {
            JsonObject o = e.getAsJsonObject();
            String strategyType = firstStr(o, "strategyType", "strategytype", "strategy_type");
            if (!strategyType.isEmpty()) {
                int mc = firstInt(o, "marketCount", "marketcount");
                out.add(new ExpiryGroup(strategyType, firstStr(o, "expiryDate", "expirydate", "expiry_date"), mc));
            }
        }
        return out;
    }

    /** Markets under an expiry group. */
    public List<ExpiryMarket> loadExpiryMarkets(String token, String exchangeId, String contractId,
                                                String strategyType, String expiryDate)
            throws IOException, InterruptedException {
        Map<String, String> q = new LinkedHashMap<>();
        q.put("exchangeid", exchangeId);
        q.put("contractid", contractId);
        q.put("strategytype", strategyType);
        if (!"None".equals(strategyType) && !expiryDate.isEmpty()) {
            q.put("expirydate", expiryDate);
        }
        JsonArray arr = getJson(token, "/markets/picker", q).getAsJsonArray();
        List<ExpiryMarket> out = new ArrayList<>();
        for (JsonElement e : arr) {
            JsonObject o = e.getAsJsonObject();
            String marketId = firstStr(o, "marketID", "marketId", "market_id");
            if (!marketId.isEmpty()) {
                out.add(new ExpiryMarket(marketId, firstStr(o, "expiryDate", "expirydate", "expiry_date"),
                        firstStr(o, "description", "Description")));
            }
        }
        return out;
    }

    // -----------------------------------------------------------------------
    // Chart
    // -----------------------------------------------------------------------

    /** Fetch + decode the initial (small) lookback window; also returns the window start. */
    public FetchResult fetchChart(String token, String exchangeId, String contractId, String marketId,
                                  String barInterval, int barPeriod) throws IOException, InterruptedException {
        LocalDate today = LocalDate.now();
        LocalDate start = today.minusDays(initialLookbackDays(barInterval));
        List<Candle> candles = fetchChartRange(token, exchangeId, contractId, marketId, barInterval, barPeriod, start, today);
        return new FetchResult(candles, start);
    }

    public record FetchResult(List<Candle> candles, LocalDate windowStart) {
    }

    /** Fetch + decode bars for an explicit [start, end] trade-date range. */
    public List<Candle> fetchChartRange(String token, String exchangeId, String contractId, String marketId,
                                        String barInterval, int barPeriod, LocalDate start, LocalDate end)
            throws IOException, InterruptedException {
        Map<String, String> q = new LinkedHashMap<>();
        q.put("exchangeId", exchangeId);
        q.put("contractId", contractId);
        q.put("chartType", "Bar");
        q.put("barInterval", barInterval);
        q.put("barPeriod", Integer.toString(barPeriod));
        q.put("tradeDateStart", start.format(YMD));
        q.put("tradeDateEnd", end.format(YMD));
        if (marketId != null && !marketId.isEmpty()) {
            q.put("marketID", marketId);
        }

        HttpRequest req = HttpRequest.newBuilder(URI.create(apiBase + "/chart/barchart" + query(q)))
                .header("Authorization", "Bearer " + token)
                // Binary T4BinAggr is only returned when octet-stream is requested.
                .header("Accept", "application/octet-stream")
                .GET()
                .build();
        HttpResponse<byte[]> resp = http.send(req, HttpResponse.BodyHandlers.ofByteArray());
        if (resp.statusCode() / 100 != 2) {
            throw new IOException("barchart request failed: HTTP " + resp.statusCode());
        }
        return decodeBars(resp.body());
    }

    /**
     * Page backwards from {@code windowStart}, stepping one lookback chunk at a time and
     * skipping empty chunks, until bars are found or the history floor is reached.
     */
    public OlderPage fetchOlder(String token, String exchangeId, String contractId, String marketId,
                                String barInterval, int barPeriod, LocalDate windowStart)
            throws IOException, InterruptedException {
        long step = lookbackDays(barInterval);
        LocalDate end = windowStart;
        for (int i = 0; i < 8; i++) {
            if (!end.isAfter(HISTORY_FLOOR)) {
                return new OlderPage(List.of(), HISTORY_FLOOR, true);
            }
            LocalDate start = end.minusDays(step);
            boolean atFloor = !start.isAfter(HISTORY_FLOOR);
            if (atFloor) {
                start = HISTORY_FLOOR;
            }
            List<Candle> candles = fetchChartRange(token, exchangeId, contractId, marketId, barInterval, barPeriod, start, end);
            if (!candles.isEmpty()) {
                return new OlderPage(candles, start, atFloor);
            }
            if (atFloor) {
                return new OlderPage(List.of(), HISTORY_FLOOR, true);
            }
            end = start;
        }
        return new OlderPage(List.of(), end, false);
    }

    private static List<Candle> decodeBars(byte[] response) throws IOException {
        byte[] payload;
        try {
            payload = T4BinPayload.extract(response);
        } catch (IllegalArgumentException e) {
            String preview = new String(response, 0, Math.min(response.length, 200), StandardCharsets.UTF_8);
            throw new IOException("failed to extract T4Bin payload (" + response.length + " bytes, starts: " + preview + ")");
        }
        if (payload.length == 0) {
            return new ArrayList<>();
        }

        List<Candle> candles = new ArrayList<>();
        ChartDataStreamReaderAggr.read(payload, new ChartDataStreamReaderAggr.ChartDataHandler() {
            @Override
            public void onBar(ChartFormatAggr.Bar bar) {
                candles.add(new Candle(
                        ticksToUnixMs(bar.Time.getTicks()),
                        priceD(bar.OpenPrice), priceD(bar.HighPrice), priceD(bar.LowPrice), priceD(bar.ClosePrice),
                        bar.Volume));
            }

            @Override public void onMarketDefinition(ChartFormatAggr.MarketDefinition m) { }
            @Override public void onModeChange(String id, NDateTime td, NDateTime t, MarketMode m) { }
            @Override public void onSettlement(String id, NDateTime td, NDateTime t, Price p, boolean held) { }
            @Override public void onOpenInterest(String id, NDateTime td, NDateTime t, int oi) { }
        });
        return candles;
    }

    public static long ticksToUnixMs(long ticks) {
        return (ticks - DOTNET_UNIX_EPOCH_TICKS) / 10_000;
    }

    /** Bar length in seconds for interval × period, used to bucket live ticks. */
    public static long intervalToSecs(String barInterval, int barPeriod) {
        long unit = switch (barInterval) {
            case "Second" -> 1;
            case "Hour" -> 3_600;
            case "Day" -> 86_400;
            case "Week" -> 604_800;
            default -> 60; // Minute
        };
        return unit * Math.max(1, barPeriod);
    }

    private static long lookbackDays(String barInterval) {
        return switch (barInterval) {
            case "Second" -> 1;
            case "Hour" -> 30;
            case "Day" -> 365;
            case "Week" -> 5 * 365;
            default -> 5; // Minute
        };
    }

    private static long initialLookbackDays(String barInterval) {
        return switch (barInterval) {
            case "Second" -> 1;
            case "Hour" -> 7;
            case "Day" -> 90;
            case "Week" -> 365;
            default -> 1; // Minute
        };
    }

    // -----------------------------------------------------------------------
    // HTTP + JSON helpers
    // -----------------------------------------------------------------------

    private JsonElement getJson(String token, String path, Map<String, String> params)
            throws IOException, InterruptedException {
        HttpRequest req = HttpRequest.newBuilder(URI.create(apiBase + path + query(params)))
                .header("Authorization", "Bearer " + token)
                .header("Accept", "application/json")
                .GET()
                .build();
        HttpResponse<String> resp = http.send(req, HttpResponse.BodyHandlers.ofString());
        if (resp.statusCode() / 100 != 2) {
            throw new IOException(path + " failed: HTTP " + resp.statusCode());
        }
        return JsonParser.parseString(resp.body());
    }

    private static String query(Map<String, String> params) {
        if (params.isEmpty()) {
            return "";
        }
        StringBuilder sb = new StringBuilder("?");
        boolean first = true;
        for (Map.Entry<String, String> e : params.entrySet()) {
            if (!first) {
                sb.append('&');
            }
            first = false;
            sb.append(URLEncoder.encode(e.getKey(), StandardCharsets.UTF_8))
                    .append('=')
                    .append(URLEncoder.encode(e.getValue(), StandardCharsets.UTF_8));
        }
        return sb.toString();
    }

    private static String firstStr(JsonObject o, String... keys) {
        for (String k : keys) {
            JsonElement e = o.get(k);
            if (e != null && e.isJsonPrimitive()) {
                return e.getAsString();
            }
        }
        return "";
    }

    private static int firstInt(JsonObject o, String... keys) {
        for (String k : keys) {
            JsonElement e = o.get(k);
            if (e != null && e.isJsonPrimitive()) {
                try {
                    return e.getAsInt();
                } catch (NumberFormatException ignored) {
                    // try next key
                }
            }
        }
        return 0;
    }

    private static double priceD(Price p) {
        return p == null ? 0.0 : p.getDecimalValue().doubleValue();
    }

    private static String trimTrailingSlash(String s) {
        return s.endsWith("/") ? s.substring(0, s.length() - 1) : s;
    }
}
