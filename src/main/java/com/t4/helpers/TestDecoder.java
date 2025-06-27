package com.t4.helpers;

import com.auth0.jwt.JWT;
import com.auth0.jwt.interfaces.DecodedJWT;
import com.auth0.jwt.interfaces.Claim;

import java.util.HashMap;
import java.util.Map;
import java.util.Scanner;
import java.util.Date;

public class TestDecoder {

     /**
     * Decodes a JWT token without verifying the signature.
     * @param token JWT string
     * @return Map of decoded claims
     */
    public static Map<String, Object> decodeToken(String token) {
        Map<String, Object> decodedClaims = new HashMap<>();

        try {
            DecodedJWT jwt = JWT.decode(token);

            for (Map.Entry<String, Claim> entry : jwt.getClaims().entrySet()) {
                String key = entry.getKey();
                Claim claim = entry.getValue();

                if (claim.asString() != null) {
                    decodedClaims.put(key, claim.asString());
                } else if (claim.asDate() != null) {
                    decodedClaims.put(key, claim.asDate());
                } else if (claim.asBoolean() != null) {
                    decodedClaims.put(key, claim.asBoolean());
                } else if (claim.asInt() != null) {
                    decodedClaims.put(key, claim.asInt());
                } else if (claim.asLong() != null) {
                    decodedClaims.put(key, claim.asLong());
                } else {
                    decodedClaims.put(key, claim.toString());
                }
            }

        } catch (Exception e) {
            decodedClaims.put("error", "Invalid JWT: " + e.getMessage());
        }

        return decodedClaims;
    }

    /**
     * Extracts a single claim as String.
     */
    public static String getClaim(String token, String claimName) {
        try {
            DecodedJWT jwt = JWT.decode(token);
            return jwt.getClaim(claimName).asString();
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * Extracts the expiration date of the token, if available.
     */
    public static Date getExpiration(String token) {
        try {
            DecodedJWT jwt = JWT.decode(token);
            return jwt.getExpiresAt();
        } catch (Exception e) {
            return null;
        }
    }
}