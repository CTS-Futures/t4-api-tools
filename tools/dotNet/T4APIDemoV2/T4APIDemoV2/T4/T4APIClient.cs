using Google.Protobuf;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using System.Collections.Concurrent;
using System.Net.Http.Headers;
using System.Security.Authentication;
using System.Net.WebSockets;
using T4APIDemo.T4.CredentialProviders;
using T4APIDemo.T4.Util;
using T4Proto.V2.Account;
using T4Proto.V2.Auth;
using T4Proto.V2.Common;
using T4Proto.V2.Market;
using T4Proto.V2.Orderrouting;
using T4Proto.V2.Service;

namespace T4APIDemo.T4;

/// <summary>
/// Headless .NET client for the T4 v2 WebSocket API.
/// REST calls use the bearer token issued by the WebSocket session.
/// </summary>
public sealed class T4APIClient : IDisposable
{
    private const int HeartbeatIntervalMs = 20_000;
    private const int MessageTimeoutSeconds = 60;

    private readonly ILogger<T4APIClient> _logger;
    private readonly ICredentialProvider _credentialProvider;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly Uri _webSocketUri;
    private readonly Uri _restUri;
    private readonly CancellationTokenSource _shutdown = new();
    private readonly SemaphoreSlim _connectionLock = new(1, 1);
    private readonly List<(string ExchangeId, string ContractId, string MarketId, Quotes Quotes, bool Ticker)> _marketSubscriptions = [];
    private readonly object _subscriptionLock = new();
    private readonly ConcurrentDictionary<string, MarketDetails> _markets = new();

    private ClientWebSocket _client = new();
    private LoginResponse? _loginResponse;
    private AuthenticationToken? _authToken;
    private TaskCompletionSource<AuthenticationToken>? _pendingTokenRequest;
    private DateTime _lastMessageReceivedUtc = DateTime.MinValue;
    private DateTime? _connectedSinceUtc;
    private int _disconnectionCount;
    private bool _isDisposed;
    private AccountSubscribe? _lastAccountSubscription;

    public event EventHandler<ConnectionStatusEventArgs>? OnConnectionStatusChanged;
    public event Action<ServerMessage>? OnServerMessage;
    public event Action<LoginResponse>? OnLogin;
    public event Action<MarketDetails>? OnMarketDetails;
    public event Action<MarketDepth>? OnMarketDepth;
    public event Action<MarketTrade>? OnMarketTrade;
    public event Action<MarketByOrderSnapshot>? OnMarketByOrderSnapshot;
    public event Action<MarketByOrderUpdate>? OnMarketByOrderUpdate;
    public event Action<AccountSnapshot>? OnAccountSnapshot;
    public event Action<AccountUpdate>? OnAccountUpdate;
    public event Action<AccountPosition>? OnAccountPosition;
    public event Action<OrderUpdate>? OnOrderUpdate;
    public event Action<OrderTrade>? OnOrderTrade;
    public event Action<MarginInquiryResponse>? OnMarginInquiryResponse;
    public event Action<OrderBatchAcknowledge>? OnOrderBatchAcknowledge;
    public event Action<OrderBatchReject>? OnOrderBatchReject;

    public T4APIClient(
        ICredentialProvider credentialProvider,
        ILogger<T4APIClient> logger,
        IHttpClientFactory httpClientFactory,
        IConfiguration configuration)
    {
        _credentialProvider = credentialProvider;
        _logger = logger;
        _httpClientFactory = httpClientFactory;
        _webSocketUri = new Uri(configuration["T4API:WebSocketUri"] ?? throw new ArgumentException("T4API:WebSocketUri is required."));
        _restUri = new Uri(configuration["T4API:RESTUri"] ?? throw new ArgumentException("T4API:RESTUri is required."));
    }

    public bool IsConnected => _client.State == WebSocketState.Open;
    public string? ConnectedUserId => _loginResponse?.UserId;
    public LoginResponse? LoginResponse => _loginResponse;
    public IReadOnlyDictionary<string, MarketDetails> Markets => _markets;

    public async Task StartAsync()
    {
        ThrowIfDisposed();
        await ConnectAsync();
        _ = ReceiveLoopAsync();
        _ = HeartbeatLoopAsync();
        _logger.LogInformation("T4 v2 API client startup complete.");
    }

    public async Task<HttpClient> GetHttpClientAsync()
    {
        ThrowIfDisposed();
        var client = _httpClientFactory.CreateClient("T4API");
        client.BaseAddress ??= _restUri;

        var token = await GetAuthToken();
        if (token?.HasToken == true && !string.IsNullOrWhiteSpace(token.Token))
        {
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token.Token);
        }
        else
        {
            _logger.LogWarning("No REST bearer token is available.");
        }

        return client;
    }

    public async Task<AuthenticationToken?> GetAuthToken()
    {
        if (_authToken?.ExpireTime != null && _authToken.ExpireTime.ToDateTime() > DateTime.UtcNow.AddSeconds(30))
        {
            return _authToken;
        }

        if (_pendingTokenRequest != null)
        {
            return await _pendingTokenRequest.Task;
        }

        var pending = new TaskCompletionSource<AuthenticationToken>(TaskCreationOptions.RunContinuationsAsynchronously);
        _pendingTokenRequest = pending;
        try
        {
            await SendMessageAsync(new AuthenticationTokenRequest
            {
                RequestId = Guid.NewGuid().ToString("N")
            });
            return await pending.Task.WaitAsync(TimeSpan.FromSeconds(30));
        }
        finally
        {
            if (ReferenceEquals(_pendingTokenRequest, pending))
            {
                _pendingTokenRequest = null;
            }
        }
    }

    #region Market data

    public async Task SubscribeMarket(
        string exchangeId,
        string contractId,
        string marketId,
        Quotes quotes = Quotes.FullOrderBook,
        bool ticker = true)
    {
        var subscription = (exchangeId, contractId, marketId, quotes, ticker);
        lock (_subscriptionLock)
        {
            if (!_marketSubscriptions.Contains(subscription))
            {
                _marketSubscriptions.Add(subscription);
            }
        }

        await SendMessageAsync(new MarketSubscribe
        {
            ExchangeId = exchangeId,
            ContractId = contractId,
            MarketId = marketId,
            Quotes = quotes,
            Ticker = ticker
        });
    }

    public Task UnsubscribeMarket(string exchangeId, string contractId, string marketId) =>
        SubscribeMarket(exchangeId, contractId, marketId, Quotes.None, false);

    #endregion

    #region Account data

    public async Task SubscribeAccounts(IEnumerable<string> accountIds, AccountSubscribeType subscribe = AccountSubscribeType.AllUpdates)
    {
        var request = new AccountSubscribe
        {
            Subscribe = subscribe,
            SubscribeAllAccounts = false
        };
        request.AccountId.Add(accountIds);
        _lastAccountSubscription = request;
        await SendMessageAsync(request);
    }

    public async Task SubscribeAllAccounts(AccountSubscribeType subscribe = AccountSubscribeType.AllUpdates)
    {
        var request = new AccountSubscribe
        {
            Subscribe = subscribe,
            SubscribeAllAccounts = true
        };
        _lastAccountSubscription = request;
        await SendMessageAsync(request);
    }

    #endregion

    #region Order routing

    // The server acknowledges and reports lifecycle changes through OnOrderUpdate.
    public Task SubmitOrderAsync(OrderSubmit request) => SendMessageAsync(request);
    public Task ReviseOrderAsync(OrderRevise request) => SendMessageAsync(request);
    public Task PullOrderAsync(OrderPull request) => SendMessageAsync(request);
    public Task SubmitOrderBatchAsync(OrderBatch request) => SendMessageAsync(request);
    public Task CreateUserDefinedStrategyAsync(CreateUDS request) => SendMessageAsync(request);

    #endregion

    public async Task SendMessageAsync(IMessage message)
    {
        ThrowIfDisposed();
        if (_client.State != WebSocketState.Open)
        {
            throw new InvalidOperationException("T4 v2 WebSocket is not connected.");
        }

        var envelope = ClientMessageHelper.CreateClientMessage(message)
            ?? throw new ArgumentException($"Unsupported T4 v2 message type: {message.GetType().FullName}", nameof(message));

        await _client.SendAsync(
            envelope.ToByteArray(),
            WebSocketMessageType.Binary,
            true,
            _shutdown.Token);
    }

    public void Republish()
    {
        if (_loginResponse != null)
        {
            OnLogin?.Invoke(_loginResponse);
        }

        foreach (var market in _markets.Values)
        {
            OnMarketDetails?.Invoke(market);
        }
    }

    public void Dispose()
    {
        if (_isDisposed)
        {
            return;
        }

        _isDisposed = true;
        _shutdown.Cancel();
        _connectionLock.Dispose();
        _shutdown.Dispose();

        if (_client.State == WebSocketState.Open)
        {
            try
            {
                _client.CloseAsync(WebSocketCloseStatus.NormalClosure, "Disposing", CancellationToken.None)
                    .GetAwaiter()
                    .GetResult();
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "T4 v2 WebSocket close failed during disposal.");
            }
        }

        _client.Dispose();
    }

    private async Task ConnectAsync()
    {
        await _connectionLock.WaitAsync(_shutdown.Token);
        try
        {
            if (_client.State == WebSocketState.Open)
            {
                return;
            }

            _client.Dispose();
            _client = new ClientWebSocket();
            _logger.LogInformation("Connecting to T4 v2 WebSocket {Uri}", _webSocketUri);
            await _client.ConnectAsync(_webSocketUri, _shutdown.Token);

            var loginRequest = await _credentialProvider.GetLoginRequestAsync();
            await SendMessageAsync(loginRequest);
            var loginMessage = await ReceiveMessageAsync();
            if (loginMessage.PayloadCase != ServerMessage.PayloadOneofCase.LoginResponse)
            {
                throw new AuthenticationException($"Expected v2 login response, received {loginMessage.PayloadCase}.");
            }

            _loginResponse = loginMessage.LoginResponse;
            if (_loginResponse.Result != LoginResult.Success)
            {
                throw new AuthenticationException($"T4 v2 authentication failed: {_loginResponse.ErrorMessage}");
            }

            _authToken = _loginResponse.AuthenticationToken;
            _connectedSinceUtc = DateTime.UtcNow;
            _lastMessageReceivedUtc = DateTime.UtcNow;
            PublishConnectionStatus(true);
            OnLogin?.Invoke(_loginResponse);
        }
        finally
        {
            _connectionLock.Release();
        }
    }

    private async Task ReceiveLoopAsync()
    {
        while (!_isDisposed && !_shutdown.IsCancellationRequested)
        {
            try
            {
                var message = await ReceiveMessageAsync();
                _lastMessageReceivedUtc = DateTime.UtcNow;
                ProcessServerMessage(message);
            }
            catch (OperationCanceledException) when (_shutdown.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "T4 v2 receive loop disconnected; reconnecting.");
                PublishConnectionStatus(false);
                await Task.Delay(TimeSpan.FromSeconds(1), _shutdown.Token);
                await ConnectAsync();
                await ResubscribeAsync();
            }
        }
    }

    private async Task HeartbeatLoopAsync()
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMilliseconds(HeartbeatIntervalMs));
        while (!_isDisposed && await timer.WaitForNextTickAsync(_shutdown.Token))
        {
            if (_client.State != WebSocketState.Open)
            {
                continue;
            }

            await SendMessageAsync(new Heartbeat
            {
                Timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
            });

            if ((DateTime.UtcNow - _lastMessageReceivedUtc).TotalSeconds > MessageTimeoutSeconds)
            {
                _logger.LogWarning("T4 v2 connection has exceeded the message timeout.");
                await _client.CloseAsync(WebSocketCloseStatus.EndpointUnavailable, "Message timeout", _shutdown.Token);
            }
        }
    }

    private async Task ResubscribeAsync()
    {
        List<(string ExchangeId, string ContractId, string MarketId, Quotes Quotes, bool Ticker)> markets;
        lock (_subscriptionLock)
        {
            markets = [.. _marketSubscriptions];
        }

        foreach (var market in markets)
        {
            await SendMessageAsync(new MarketSubscribe
            {
                ExchangeId = market.ExchangeId,
                ContractId = market.ContractId,
                MarketId = market.MarketId,
                Quotes = market.Quotes,
                Ticker = market.Ticker
            });
        }

        if (_lastAccountSubscription != null)
        {
            await SendMessageAsync(_lastAccountSubscription);
        }
    }

    private async Task<ServerMessage> ReceiveMessageAsync()
    {
        using var stream = new MemoryStream();
        var buffer = new byte[8192];

        while (true)
        {
            var result = await _client.ReceiveAsync(buffer, _shutdown.Token);
            if (result.MessageType == WebSocketMessageType.Close)
            {
                throw new WebSocketException("T4 v2 server closed the connection.");
            }

            await stream.WriteAsync(buffer.AsMemory(0, result.Count), _shutdown.Token);
            if (result.EndOfMessage)
            {
                return ServerMessage.Parser.ParseFrom(stream.ToArray());
            }
        }
    }

    private void ProcessServerMessage(ServerMessage message)
    {
        OnServerMessage?.Invoke(message);

        switch (message.PayloadCase)
        {
            case ServerMessage.PayloadOneofCase.Heartbeat:
                break;
            case ServerMessage.PayloadOneofCase.AuthenticationToken:
                _authToken = message.AuthenticationToken;
                _pendingTokenRequest?.TrySetResult(message.AuthenticationToken);
                break;
            case ServerMessage.PayloadOneofCase.MarketDetails:
                _markets[message.MarketDetails.MarketId] = message.MarketDetails;
                OnMarketDetails?.Invoke(message.MarketDetails);
                break;
            case ServerMessage.PayloadOneofCase.MarketDepth:
                OnMarketDepth?.Invoke(message.MarketDepth);
                break;
            case ServerMessage.PayloadOneofCase.MarketTrade:
                OnMarketTrade?.Invoke(message.MarketTrade);
                break;
            case ServerMessage.PayloadOneofCase.MarketByOrderSnapshot:
                OnMarketByOrderSnapshot?.Invoke(message.MarketByOrderSnapshot);
                break;
            case ServerMessage.PayloadOneofCase.MarketByOrderUpdate:
                OnMarketByOrderUpdate?.Invoke(message.MarketByOrderUpdate);
                break;
            case ServerMessage.PayloadOneofCase.AccountSnapshot:
                OnAccountSnapshot?.Invoke(message.AccountSnapshot);
                break;
            case ServerMessage.PayloadOneofCase.AccountUpdate:
                OnAccountUpdate?.Invoke(message.AccountUpdate);
                break;
            case ServerMessage.PayloadOneofCase.AccountPosition:
                OnAccountPosition?.Invoke(message.AccountPosition);
                break;
            case ServerMessage.PayloadOneofCase.OrderUpdate:
                OnOrderUpdate?.Invoke(message.OrderUpdate);
                break;
            case ServerMessage.PayloadOneofCase.OrderTrade:
                OnOrderTrade?.Invoke(message.OrderTrade);
                break;
            case ServerMessage.PayloadOneofCase.MarginInquiryResponse:
                OnMarginInquiryResponse?.Invoke(message.MarginInquiryResponse);
                break;
            case ServerMessage.PayloadOneofCase.OrderBatchAcknowledge:
                OnOrderBatchAcknowledge?.Invoke(message.OrderBatchAcknowledge);
                break;
            case ServerMessage.PayloadOneofCase.OrderBatchReject:
                OnOrderBatchReject?.Invoke(message.OrderBatchReject);
                break;
        }
    }

    private void PublishConnectionStatus(bool isConnected)
    {
        if (isConnected)
        {
            _connectedSinceUtc ??= DateTime.UtcNow;
        }
        else
        {
            _connectedSinceUtc = null;
            _disconnectionCount++;
        }

        OnConnectionStatusChanged?.Invoke(this, new ConnectionStatusEventArgs(
            isConnected,
            _connectedSinceUtc.HasValue ? DateTime.UtcNow - _connectedSinceUtc.Value : TimeSpan.Zero,
            _disconnectionCount));
    }

    private void ThrowIfDisposed()
    {
        ObjectDisposedException.ThrowIf(_isDisposed, this);
    }
}
