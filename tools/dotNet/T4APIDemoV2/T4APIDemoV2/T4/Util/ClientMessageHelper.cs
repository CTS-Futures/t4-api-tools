namespace T4APIDemo.T4.Util;

using Google.Protobuf;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using T4Proto.V2.Service;

public static class ClientMessageHelper
{
    private static readonly Dictionary<Type, Action<ClientMessage, IMessage>> _setters;

    static ClientMessageHelper()
    {
        _setters = typeof(ClientMessage)
            .GetProperties(BindingFlags.Public | BindingFlags.Instance)
            .Where(p => typeof(IMessage).IsAssignableFrom(p.PropertyType))
            .ToDictionary(
                p => p.PropertyType, // Key: The Protobuf message type
                p =>
                {
                    var setter = p.GetSetMethod(); // Get the property setter method
                    return (Action<ClientMessage, IMessage>)((msg, val) => setter?.Invoke(msg, new object[] { val }));
                }
            );
    }

    public static ClientMessage? CreateClientMessage(IMessage message)
    {
        if (message == null)
            return null;

        if (_setters.TryGetValue(message.GetType(), out var setter))
        {
            var clientMessage = new ClientMessage();
            setter(clientMessage, message);
            return clientMessage;
        }

        return null; // Return null instead of throwing
    }
}
