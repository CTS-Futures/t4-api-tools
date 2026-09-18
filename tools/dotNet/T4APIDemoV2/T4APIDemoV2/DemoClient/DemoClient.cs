using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using T4APIDemo.T4;
using T4Proto.V2.Market;

namespace T4APIDemo.DemoClient;

/// <summary>
/// Minimal v2 console host. It connects, subscribes to account data, and logs
/// v2 market/order events. Order routing is exposed by T4APIClient but is not
/// triggered automatically by this sample host.
/// </summary>
public sealed class DemoClient : BackgroundService
{
    private readonly ILogger<DemoClient> _logger;
    private readonly T4APIClient _apiClient;

    public DemoClient(ILogger<DemoClient> logger, T4APIClient apiClient)
    {
        _logger = logger;
        _apiClient = apiClient;
        _apiClient.OnConnectionStatusChanged += OnConnectionStatusChanged;
        _apiClient.OnLogin += OnLogin;
        _apiClient.OnMarketDetails += OnMarketDetails;
        _apiClient.OnMarketDepth += OnMarketDepth;
        _apiClient.OnMarketTrade += OnMarketTrade;
        _apiClient.OnOrderUpdate += OnOrderUpdate;
        _apiClient.OnOrderTrade += OnOrderTrade;
        _apiClient.OnOrderBatchAcknowledge += OnOrderBatchAcknowledge;
        _apiClient.OnOrderBatchReject += OnOrderBatchReject;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("T4APIDemoV2 starting...");
        await _apiClient.StartAsync();
        await _apiClient.SubscribeAllAccounts();

        // Example market subscription:
        //await _apiClient.SubscribeMarket("CME_Eq", "ES", "XCME_Eq ES (M26)");

        try
        {
            await Task.Delay(Timeout.InfiniteTimeSpan, stoppingToken);
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            // Normal host shutdown.
        }
    }

    public override void Dispose()
    {
        _apiClient.OnConnectionStatusChanged -= OnConnectionStatusChanged;
        _apiClient.OnLogin -= OnLogin;
        _apiClient.OnMarketDetails -= OnMarketDetails;
        _apiClient.OnMarketDepth -= OnMarketDepth;
        _apiClient.OnMarketTrade -= OnMarketTrade;
        _apiClient.OnOrderUpdate -= OnOrderUpdate;
        _apiClient.OnOrderTrade -= OnOrderTrade;
        _apiClient.OnOrderBatchAcknowledge -= OnOrderBatchAcknowledge;
        _apiClient.OnOrderBatchReject -= OnOrderBatchReject;
        base.Dispose();
    }

    private void OnConnectionStatusChanged(object? sender, ConnectionStatusEventArgs e) =>
        _logger.LogInformation("T4 v2 connection: Connected={Connected}, Disconnections={Disconnections}", e.IsConnected, e.DisconnectionCount);

    private void OnLogin(T4Proto.V2.Auth.LoginResponse response) =>
        _logger.LogInformation("Logged in to T4 v2 as {UserId}; accounts={AccountCount}, exchanges={ExchangeCount}", response.UserId, response.Accounts.Count, response.Exchanges.Count);

    private void OnMarketDetails(MarketDetails details) =>
        _logger.LogInformation("Market details: {MarketId} ({ExchangeId}/{ContractId})", details.MarketId, details.ExchangeId, details.ContractId);

    private void OnMarketDepth(MarketDepth depth) =>
        _logger.LogDebug("Market depth: {MarketId}, delayed={Delayed}", depth.MarketId, depth.Delayed);

    private void OnMarketTrade(MarketTrade trade) =>
        _logger.LogInformation("Market trade: {MarketId}, volume={Volume}", trade.MarketId, trade.LastTradeVolume);

    private void OnOrderUpdate(T4Proto.V2.Orderrouting.OrderUpdate update) =>
        _logger.LogInformation("Order update: {UniqueId}, account={AccountId}, market={MarketId}, type={UpdateType}, status={Status}, detail={Detail}", update.UniqueId, update.AccountId, update.MarketId, update.UpdateType, update.Status, update.StatusDetail);

    private void OnOrderTrade(T4Proto.V2.Orderrouting.OrderTrade trade) =>
        _logger.LogInformation("Order trade: order={OrderId}, account={AccountId}, volume={Volume}, exchangeTrade={ExchangeTradeId}", trade.OrderId, trade.AccountId, trade.Volume.Value, trade.ExchangeTradeId);

    private void OnOrderBatchAcknowledge(T4Proto.V2.Orderrouting.OrderBatchAcknowledge acknowledgement) =>
        _logger.LogInformation("Order batch accepted: {BatchId}, submissions={Count}", acknowledgement.BatchId, acknowledgement.Accepted.Count);

    private void OnOrderBatchReject(T4Proto.V2.Orderrouting.OrderBatchReject rejection) =>
        _logger.LogWarning("Order batch rejected: {BatchId}, reason={Reason}, errors={Count}", rejection.BatchId, rejection.Reason, rejection.Errors.Count);
}
