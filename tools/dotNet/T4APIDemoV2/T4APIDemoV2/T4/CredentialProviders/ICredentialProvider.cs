namespace T4APIDemo.T4.CredentialProviders;

public interface ICredentialProvider
{
    Task<T4Proto.V2.Auth.LoginRequest> GetLoginRequestAsync();
}
