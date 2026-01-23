using System.Text.Json;
using System.Text;
using System.Net.Http.Headers;
using Microsoft.Extensions.Options;

namespace T4BinaryChartDataDemo;

internal class Demo
{
    private readonly T4DemoConfig _config;
    private readonly HttpClient _httpClient;
    private string? _authToken;

    public Demo(IOptions<T4DemoConfig> config)
    {
        _config = config.Value;
        _httpClient = new HttpClient();
    }

    public async Task Run()
    {
        // Trade date to request (yesterday, skip weekends.)
        DateTime tradeDate = DateTime.Today;
        while (tradeDate.DayOfWeek == DayOfWeek.Sunday || tradeDate.DayOfWeek == DayOfWeek.Saturday) tradeDate = tradeDate.AddDays(-1);

        Console.WriteLine("Requesting the front month ES MarketID");
        var esMarketID = await RequestFrontMonthMarketID(_config.FutureContract.ExchangeId, _config.FutureContract.ContractId);
        Console.WriteLine($"> {esMarketID}");
        Console.WriteLine("");

        Console.WriteLine($"Requesting trade history for {esMarketID} {tradeDate:yyyy-MM-dd} (decoding using streaming)");
        await RequestTradeHistoryDecodeStreaming(_config.FutureContract.ExchangeId, _config.FutureContract.ContractId, esMarketID, tradeDate);
        Console.WriteLine("");

        Console.WriteLine($"Requesting trade history for {esMarketID} {tradeDate:yyyy-MM-dd} (decoding bulk)");
        await RequestTradeHistoryDecodeBulk(_config.FutureContract.ExchangeId, _config.FutureContract.ContractId, esMarketID, tradeDate);
        Console.WriteLine("");

        Console.WriteLine($"Requesting minute bars for {esMarketID} {tradeDate:yyyy-MM-dd} (decoding using streaming)");
        await RequestBarsDecodeStreaming(_config.FutureContract.ExchangeId, _config.FutureContract.ContractId, esMarketID, tradeDate);
        Console.WriteLine("");

        Console.WriteLine($"Requesting minute bars for {esMarketID} {tradeDate:yyyy-MM-dd} (decoding bulk)");
        await RequestBarsDecodeBulk(_config.FutureContract.ExchangeId, _config.FutureContract.ContractId, esMarketID, tradeDate);
        Console.WriteLine("");

        Console.WriteLine($"Requesting consolidated data for {_config.FutureContract.ContractId} {tradeDate:yyyy-MM-dd} (decoding using streaming)");
        await RequestConsolidatedDecodeStreaming(_config.OptionContract.ExchangeId, _config.OptionContract.ContractId, tradeDate);
        Console.WriteLine("");

        Console.WriteLine($"Requesting consolidated data for {_config.FutureContract.ContractId} {tradeDate:yyyy-MM-dd} (decoding bulk)");
        await RequestConsolidatedDecodeBulk(_config.OptionContract.ExchangeId, _config.OptionContract.ContractId, tradeDate);
        Console.WriteLine("");
    }

    private async Task<string?> GetAuthToken()
    {
        if (!string.IsNullOrEmpty(_config.ApiKey))
            return null; // Use API key instead

        if (!string.IsNullOrEmpty(_authToken))
            return _authToken;

        var authRequest = new
        {
            firm = _config.Firm,
            userName = _config.UserName,
            password = _config.Password,
            appName = _config.AppName,
            appLicense = _config.AppLicense,
            priceFormat = _config.PriceFormat
        };

        var json = JsonSerializer.Serialize(authRequest);
        var content = new StringContent(json, Encoding.UTF8, "application/json");

        var response = await _httpClient.PostAsync($"{_config.ApiUrl}/login", content);

        if (!response.IsSuccessStatusCode)
            throw new HttpRequestException($"Authentication failed: {response.StatusCode}");

        var responseJson = await response.Content.ReadAsStringAsync();
        var authResponse = JsonSerializer.Deserialize<JsonElement>(responseJson);

        _authToken = authResponse.GetProperty("token").GetString();
        return _authToken;
    }


    private async Task<string> RequestFrontMonthMarketID(string exchangeID, string contractID)
    {
        var request = new HttpRequestMessage(HttpMethod.Get,
            $"{_config.ApiUrl}/markets/picker/firstmarket?exchangeid={exchangeID}&contractid={contractID}");

        if (!string.IsNullOrEmpty(_config.ApiKey))
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("APIKey", _config.ApiKey);
        }
        else
        {
            var token = await GetAuthToken();
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        }

        var response = await _httpClient.SendAsync(request);

        if (!response.IsSuccessStatusCode)
            throw new HttpRequestException($"Failed to get market ID: {response.StatusCode}");

        var json = await response.Content.ReadAsStringAsync();
        var data = JsonSerializer.Deserialize<JsonElement>(json);

        return data.GetProperty("marketID").GetString() ?? string.Empty;
    }

    private async Task RequestTradeHistoryDecodeStreaming(string exchangeID, string contractID, string marketID, DateTime tradeDate)
    {
        var sw = System.Diagnostics.Stopwatch.StartNew();

        var request = new HttpRequestMessage(HttpMethod.Get,
            $"{_config.ApiUrl}/chart/tradehistory?exchangeId={exchangeID}&contractId={contractID}&marketID={Uri.EscapeDataString(marketID)}&tradeDateStart={tradeDate:yyyy-MM-dd}&tradeDateEnd={tradeDate:yyyy-MM-dd}");

        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/t4"));

        if (!string.IsNullOrEmpty(_config.ApiKey))
            request.Headers.Authorization = new AuthenticationHeaderValue("APIKey", _config.ApiKey);
        else
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", await GetAuthToken());

        var response = await _httpClient.SendAsync(request);
        response.EnsureSuccessStatusCode();

        var bytes = await response.Content.ReadAsByteArrayAsync();
        var requestTime = sw.ElapsedMilliseconds;

        sw.Restart();
        using var stream = new MemoryStream(bytes);
        var decoder = new T4ChartDecoder.T4BinaryDecoder();

        int tradeCount = 0;
        await foreach (var record in decoder.DecodeStream(stream))
        {
            if (record is T4ChartDecoder.Trade)
                tradeCount++;
        }
        var decodeTime = sw.ElapsedMilliseconds;

        Console.WriteLine($"  Request time: {requestTime}ms");
        Console.WriteLine($"  Decode time:  {decodeTime}ms");
        Console.WriteLine($"  Total time:   {requestTime + decodeTime}ms");
        Console.WriteLine($"  Bytes:        {bytes.Length:N0}");
        Console.WriteLine($"  Trades:       {tradeCount:N0}");
    }

    private async Task RequestTradeHistoryDecodeBulk(string exchangeID, string contractID, string marketID, DateTime tradeDate)
    {
        var sw = System.Diagnostics.Stopwatch.StartNew();

        var request = new HttpRequestMessage(HttpMethod.Get,
            $"{_config.ApiUrl}/chart/tradehistory?exchangeId={exchangeID}&contractId={contractID}&marketID={Uri.EscapeDataString(marketID)}&tradeDateStart={tradeDate:yyyy-MM-dd}&tradeDateEnd={tradeDate:yyyy-MM-dd}");

        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/t4"));

        if (!string.IsNullOrEmpty(_config.ApiKey))
            request.Headers.Authorization = new AuthenticationHeaderValue("APIKey", _config.ApiKey);
        else
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", await GetAuthToken());

        var response = await _httpClient.SendAsync(request);
        response.EnsureSuccessStatusCode();

        var bytes = await response.Content.ReadAsByteArrayAsync();
        var requestTime = sw.ElapsedMilliseconds;

        sw.Restart();
        using var stream = new MemoryStream(bytes);
        var decoder = new T4ChartDecoder.T4BinaryDecoder();
        var collection = await decoder.DecodeAll(stream);
        var decodeTime = sw.ElapsedMilliseconds;

        Console.WriteLine($"  Request time: {requestTime}ms");
        Console.WriteLine($"  Decode time:  {decodeTime}ms");
        Console.WriteLine($"  Total time:   {requestTime + decodeTime}ms");
        Console.WriteLine($"  Bytes:        {bytes.Length:N0}");
        Console.WriteLine($"  Trades:       {collection.Trades.Count:N0}");
    }

    private async Task RequestBarsDecodeStreaming(string exchangeID, string contractID, string marketID, DateTime tradeDate)
    {
        var sw = System.Diagnostics.Stopwatch.StartNew();

        var request = new HttpRequestMessage(HttpMethod.Get,
            $"{_config.ApiUrl}/chart/barchart?exchangeId={exchangeID}&contractId={contractID}&marketID={Uri.EscapeDataString(marketID)}&chartType=Bar&barInterval=Minute&barPeriod=1&tradeDateStart={tradeDate:yyyy-MM-dd}&tradeDateEnd={tradeDate:yyyy-MM-dd}");

        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/t4"));

        if (!string.IsNullOrEmpty(_config.ApiKey))
            request.Headers.Authorization = new AuthenticationHeaderValue("APIKey", _config.ApiKey);
        else
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", await GetAuthToken());

        var response = await _httpClient.SendAsync(request);
        response.EnsureSuccessStatusCode();

        var bytes = await response.Content.ReadAsByteArrayAsync();
        var requestTime = sw.ElapsedMilliseconds;

        sw.Restart();
        using var stream = new MemoryStream(bytes);
        var decoder = new T4ChartDecoder.T4BinaryDecoder();

        int barCount = 0;
        await foreach (var record in decoder.DecodeStream(stream))
        {
            if (record is T4ChartDecoder.Bar)
                barCount++;
        }
        var decodeTime = sw.ElapsedMilliseconds;

        Console.WriteLine($"  Request time: {requestTime}ms");
        Console.WriteLine($"  Decode time:  {decodeTime}ms");
        Console.WriteLine($"  Total time:   {requestTime + decodeTime}ms");
        Console.WriteLine($"  Bytes:        {bytes.Length:N0}");
        Console.WriteLine($"  Bars:         {barCount:N0}");
    }

    private async Task RequestBarsDecodeBulk(string exchangeID, string contractID, string marketID, DateTime tradeDate)
    {
        var sw = System.Diagnostics.Stopwatch.StartNew();

        var request = new HttpRequestMessage(HttpMethod.Get,
            $"{_config.ApiUrl}/chart/barchart?exchangeId={exchangeID}&contractId={contractID}&marketID={Uri.EscapeDataString(marketID)}&chartType=Bar&barInterval=Minute&barPeriod=1&tradeDateStart={tradeDate:yyyy-MM-dd}&tradeDateEnd={tradeDate:yyyy-MM-dd}");

        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/t4"));

        if (!string.IsNullOrEmpty(_config.ApiKey))
            request.Headers.Authorization = new AuthenticationHeaderValue("APIKey", _config.ApiKey);
        else
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", await GetAuthToken());

        var response = await _httpClient.SendAsync(request);
        response.EnsureSuccessStatusCode();

        var bytes = await response.Content.ReadAsByteArrayAsync();
        var requestTime = sw.ElapsedMilliseconds;

        sw.Restart();
        using var stream = new MemoryStream(bytes);
        var decoder = new T4ChartDecoder.T4BinaryDecoder();
        var collection = await decoder.DecodeAll(stream);
        var decodeTime = sw.ElapsedMilliseconds;

        Console.WriteLine($"  Request time: {requestTime}ms");
        Console.WriteLine($"  Decode time:  {decodeTime}ms");
        Console.WriteLine($"  Total time:   {requestTime + decodeTime}ms");
        Console.WriteLine($"  Bytes:        {bytes.Length:N0}");
        Console.WriteLine($"  Bars:         {collection.Bars.Count:N0}");
    }

    private async Task RequestConsolidatedDecodeStreaming(string exchangeID, string contractID, DateTime tradeDate)
    {
        var sw = System.Diagnostics.Stopwatch.StartNew();

        var request = new HttpRequestMessage(HttpMethod.Get,
            $"{_config.ApiUrl}/chart/consolidatedchart?exchangeId={exchangeID}&contractId={contractID}&tradeDate={tradeDate:yyyy-MM-dd}");

        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/t4"));

        if (!string.IsNullOrEmpty(_config.ApiKey))
            request.Headers.Authorization = new AuthenticationHeaderValue("APIKey", _config.ApiKey);
        else
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", await GetAuthToken());

        var response = await _httpClient.SendAsync(request);
        response.EnsureSuccessStatusCode();

        var bytes = await response.Content.ReadAsByteArrayAsync();
        var requestTime = sw.ElapsedMilliseconds;

        sw.Restart();
        using var stream = new MemoryStream(bytes);
        var decoder = new T4ChartDecoder.T4BinaryDecoder();

        var markets = new HashSet<string>();
        int tradeCount = 0;

        await foreach (var record in decoder.DecodeStream(stream))
        {
            markets.Add(record.MarketId);
            if (record is T4ChartDecoder.Trade)
                tradeCount++;
        }
        var decodeTime = sw.ElapsedMilliseconds;

        Console.WriteLine($"  Request time:    {requestTime}ms");
        Console.WriteLine($"  Decode time:     {decodeTime}ms");
        Console.WriteLine($"  Total time:      {requestTime + decodeTime}ms");
        Console.WriteLine($"  Bytes:           {bytes.Length:N0}");
        Console.WriteLine($"  Unique markets:  {markets.Count:N0}");
        Console.WriteLine($"  Trades:          {tradeCount:N0}");
    }

    private async Task RequestConsolidatedDecodeBulk(string exchangeID, string contractID, DateTime tradeDate)
    {
        var sw = System.Diagnostics.Stopwatch.StartNew();

        var request = new HttpRequestMessage(HttpMethod.Get,
            $"{_config.ApiUrl}/chart/consolidatedchart?exchangeId={exchangeID}&contractId={contractID}&tradeDate={tradeDate:yyyy-MM-dd}");

        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/t4"));

        if (!string.IsNullOrEmpty(_config.ApiKey))
            request.Headers.Authorization = new AuthenticationHeaderValue("APIKey", _config.ApiKey);
        else
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", await GetAuthToken());

        var response = await _httpClient.SendAsync(request);
        response.EnsureSuccessStatusCode();

        var bytes = await response.Content.ReadAsByteArrayAsync();
        var requestTime = sw.ElapsedMilliseconds;

        sw.Restart();
        using var stream = new MemoryStream(bytes);
        var decoder = new T4ChartDecoder.T4BinaryDecoder();
        var collection = await decoder.DecodeAll(stream);
        var decodeTime = sw.ElapsedMilliseconds;

        var markets = new HashSet<string>();
        foreach (var record in collection.GetAllChronological())
            markets.Add(record.MarketId);

        Console.WriteLine($"  Request time:    {requestTime}ms");
        Console.WriteLine($"  Decode time:     {decodeTime}ms");
        Console.WriteLine($"  Total time:      {requestTime + decodeTime}ms");
        Console.WriteLine($"  Bytes:           {bytes.Length:N0}");
        Console.WriteLine($"  Unique markets:  {markets.Count:N0}");
        Console.WriteLine($"  Trades:          {collection.Trades.Count:N0}");
    }
}
