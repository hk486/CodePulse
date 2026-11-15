package com.codepulse.common.constants;

public class AppConstants {
    public static final String JWT_SECRET = "${jwt.secret:codepulse-secret-key-change-in-production}";
    public static final long JWT_EXPIRATION = 86400000; // 24 hours
    
    public static final String API_GATEWAY_URL = "http://localhost:8000";
    public static final String AUTH_SERVICE_URL = "http://localhost:8001";
    public static final String PROJECT_SERVICE_URL = "http://localhost:8002";
    public static final String ANALYSIS_SERVICE_URL = "http://localhost:8003";
    public static final String NOTIFICATION_SERVICE_URL = "http://localhost:8004";
    
    public static final String ROLE_ADMIN = "ROLE_ADMIN";
    public static final String ROLE_USER = "ROLE_USER";
}
