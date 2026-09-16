namespace T4APIDemo.T4;

public class ConnectionStatusEventArgs : EventArgs
{
    public bool IsConnected { get; }
    public TimeSpan Uptime { get; }
    public int DisconnectionCount { get; }

    public ConnectionStatusEventArgs(bool isConnected, TimeSpan uptime, int disconnectionCount)
    {
        IsConnected = isConnected;
        Uptime = uptime;
        DisconnectionCount = disconnectionCount;
    }
}