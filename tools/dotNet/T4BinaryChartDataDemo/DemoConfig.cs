namespace T4BinaryChartDataDemo;

public class ContractConfig
{
    public string ExchangeId { get; set; } = string.Empty;
    public string ContractId { get; set; } = string.Empty;
}

public class T4DemoConfig
{
    public string ApiUrl { get; set; } = string.Empty;

    // Option 1: API Key Authentication
    public string ApiKey { get; set; } = "";

    // Option 2: Credential Authentication
    public string Firm { get; set; } = "";
    public string UserName { get; set; } = "";
    public string Password { get; set; } = "";
    public string AppName { get; set; } = "";
    public string AppLicense { get; set; } = "";
    public string PriceFormat { get; set; } = "Real";

    // Contracts to request data for
    public ContractConfig FutureContract { get; set; } = new();
    public ContractConfig OptionContract { get; set; } = new();
}
