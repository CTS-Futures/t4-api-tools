package com.t4.helpers;
import t4proto.v1.auth.Auth;
import t4proto.v1.service.Service;


public class ClientMessageHelper {
    public static Service.ClientMessage wrapLoginRequest(Auth.LoginRequest loginRequest) {
        return Service.ClientMessage.newBuilder()
                .setLoginRequest(loginRequest)
                .build();
    }

}
