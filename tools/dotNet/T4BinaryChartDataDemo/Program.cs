using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using T4BinaryChartDataDemo;

var host = Host.CreateDefaultBuilder(args)
    .ConfigureAppConfiguration((context, config) =>
    {
        config.SetBasePath(Directory.GetCurrentDirectory())
              .AddJsonFile("appsettings.json", optional: false, reloadOnChange: true)
              .AddJsonFile($"appsettings.{context.HostingEnvironment.EnvironmentName}.json", optional: true)
              .AddUserSecrets<Program>(optional: true);
    })
    .ConfigureServices((context, services) =>
    {
        services.Configure<T4DemoConfig>(context.Configuration.GetSection("T4Demo"));
        services.AddTransient<Demo>();

    })
    .Build();



var demo = host.Services.GetRequiredService<Demo>();
await demo.Run();