import * as proto from './generated/proto';

export class ClientMessageHelper {
    static createClientMessage(message: any): proto.t4proto.v1.service.ClientMessage {
        const clientMessage = new proto.t4proto.v1.service.ClientMessage();

        if (message.loginRequest) clientMessage.loginRequest = message.loginRequest;
        else if (message.authenticationTokenRequest) clientMessage.authenticationTokenRequest = message.authenticationTokenRequest;
        else if (message.marketDepthSubscribe) clientMessage.marketDepthSubscribe = message.marketDepthSubscribe;
        else if (message.marketByOrderSubscribe) clientMessage.marketByOrderSubscribe = message.marketByOrderSubscribe;
        else if (message.accountSubscribe) clientMessage.accountSubscribe = message.accountSubscribe;
        else if (message.orderSubmit) clientMessage.orderSubmit = message.orderSubmit;
        else if (message.orderRevise) clientMessage.orderRevise = message.orderRevise;
        else if (message.orderPull) clientMessage.orderPull = message.orderPull;
        else if (message.createUds) clientMessage.createUds = message.createUds;
        else if (message.heartbeat) clientMessage.heartbeat = message.heartbeat;
        else throw new Error(`Unsupported message type: ${Object.keys(message)[0]}`);

        return clientMessage;
    }
}