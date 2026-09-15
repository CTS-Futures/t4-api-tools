# T4APIDemoV2

Standalone v2 copy of the .NET T4 API demo.

This version preserves the original WebSocket, protobuf, account, market-data,
and order-update client implementation. It is a console/background-service
client, not an ASP.NET server or graphical frontend.

Configure simulator credentials with .NET user secrets or environment-specific
configuration before running. The checked-in `appsettings.json` intentionally
contains no credentials.

Run from this directory:

```powershell
dotnet run --project .\T4APIDemoV2\T4APIDemoV2.csproj
```
