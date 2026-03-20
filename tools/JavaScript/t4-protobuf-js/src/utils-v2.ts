import * as proto from './generated/proto-v2';

export function encodeMessage(message: proto.t4proto.v2.service.ClientMessage): Uint8Array {
    return proto.t4proto.v2.service.ClientMessage.encode(message).finish();
}

export function decodeMessage(data: Uint8Array): proto.t4proto.v2.service.ServerMessage {
    return proto.t4proto.v2.service.ServerMessage.decode(data);
}

