package com.t4login;

/**
 * Resource localizer.
 */
public class Resource {

    public interface StringLocalizer {
        String localizeString(String name);
    }

    public static StringLocalizer stringLocalizer = null;

    public static String localizeString(String name) {
        if(stringLocalizer == null) {
            return name;
        }

        return stringLocalizer.localizeString(name);
    }
}
