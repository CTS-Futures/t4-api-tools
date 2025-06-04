import * as proto from './generated/proto';

export function encodeMessage(message: proto.t4proto.v1.service.ClientMessage): Uint8Array {
    return proto.t4proto.v1.service.ClientMessage.encode(message).finish();
}

export function decodeMessage(data: Uint8Array): proto.t4proto.v1.service.ServerMessage {
    return proto.t4proto.v1.service.ServerMessage.decode(data);
}