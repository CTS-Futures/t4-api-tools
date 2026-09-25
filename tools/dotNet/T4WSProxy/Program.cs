// T4 WebSocket Proxy
// Listens on ws://localhost:8765 and forwards to the configured T4 WSS endpoint.
// Chrome connects locally (no TLS = no CrowdStrike inspection),
// while this proxy connects upstream using .NET's Schannel stack.

using System.Net;
using System.Net.WebSockets;

const string upstreamUrl = "wss://wss-test.t4login.com/v2";
const string listenPrefix = "http://localhost:8765/";

Console.WriteLine($"T4 WebSocket Proxy");
Console.WriteLine($"  Local:    ws://localhost:8765/");
Console.WriteLine($"  Upstream: {upstreamUrl}");
Console.WriteLine($"Press Ctrl+C to stop.");
Console.WriteLine();

var listener = new HttpListener();
listener.Prefixes.Add(listenPrefix);
listener.Start();

while (true)
{
    HttpListenerContext ctx;
    try { ctx = await listener.GetContextAsync(); }
    catch { break; }

    if (!ctx.Request.IsWebSocketRequest)
    {
        ctx.Response.StatusCode = 400;
        ctx.Response.Close();
        continue;
    }

    _ = HandleConnection(ctx);
}

async Task HandleConnection(HttpListenerContext ctx)
{
    var clientId = Guid.NewGuid().ToString("N")[..8];
    Console.WriteLine($"[{clientId}] Browser connected from {ctx.Request.RemoteEndPoint}");

    HttpListenerWebSocketContext wsCtx;
    try
    {
        wsCtx = await ctx.AcceptWebSocketAsync(subProtocol: null);
    }
    catch (Exception ex)
    {
        Console.WriteLine($"[{clientId}] Failed to accept WebSocket: {ex.Message}");
        return;
    }

    var browserWs = wsCtx.WebSocket;
    var upstreamWs = new ClientWebSocket();

    try
    {
        Console.WriteLine($"[{clientId}] Connecting to upstream {upstreamUrl}...");
        await upstreamWs.ConnectAsync(new Uri(upstreamUrl), CancellationToken.None);
        Console.WriteLine($"[{clientId}] Upstream connected. Bridging...");

        using var cts = new CancellationTokenSource();

        var browserToUpstream = Relay(browserWs, upstreamWs, $"[{clientId}] browser→T4", cts);
        var upstreamToBrowser = Relay(upstreamWs, browserWs, $"[{clientId}] T4→browser", cts);

        await Task.WhenAny(browserToUpstream, upstreamToBrowser);
        cts.Cancel();
        await Task.WhenAll(browserToUpstream, upstreamToBrowser);
    }
    catch (Exception ex)
    {
        Console.WriteLine($"[{clientId}] Error: {ex.Message}");
    }
    finally
    {
        Console.WriteLine($"[{clientId}] Disconnected.");
        if (browserWs.State == WebSocketState.Open)
            try { await browserWs.CloseAsync(WebSocketCloseStatus.NormalClosure, "proxy closing", CancellationToken.None); } catch { }
        if (upstreamWs.State == WebSocketState.Open)
            try { await upstreamWs.CloseAsync(WebSocketCloseStatus.NormalClosure, "proxy closing", CancellationToken.None); } catch { }
        browserWs.Dispose();
        upstreamWs.Dispose();
    }
}

async Task Relay(WebSocket source, WebSocket dest, string label, CancellationTokenSource cts)
{
    var buffer = new byte[64 * 1024];
    try
    {
        while (!cts.Token.IsCancellationRequested)
        {
            var result = await source.ReceiveAsync(buffer, cts.Token);

            if (result.MessageType == WebSocketMessageType.Close)
            {
                Console.WriteLine($"{label}: close received");
                break;
            }

            await dest.SendAsync(
                new ArraySegment<byte>(buffer, 0, result.Count),
                result.MessageType,
                result.EndOfMessage,
                cts.Token);
        }
    }
    catch (OperationCanceledException) { }
    catch (Exception ex)
    {
        Console.WriteLine($"{label}: {ex.Message}");
    }
    finally
    {
        cts.Cancel();
    }
}
